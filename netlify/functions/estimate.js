/**
 * Netlify Function: estimate v2
 * 改善内容:
 *  1. 物件タイプでAPIデータをフィルタリング
 *  2. 外れ値除外（IQR法）
 *  3. 面積フィルタを±30%に精緻化
 *  4. UnitPriceゼロ時の自前計算
 *  5. 補正係数を最終価格に反映
 *  6. 地価公示データを組み込み（土地・戸建て・一棟）
 */

const https = require('https');
const BASE_URL = 'https://www.reinfolib.mlit.go.jp/ex-api/external';

const PREF_CODES = {
  '北海道':'01','青森':'02','岩手':'03','宮城':'04','秋田':'05','山形':'06','福島':'07',
  '茨城':'08','栃木':'09','群馬':'10','埼玉':'11','千葉':'12','東京':'13','神奈川':'14',
  '新潟':'15','富山':'16','石川':'17','福井':'18','山梨':'19','長野':'20',
  '岐阜':'21','静岡':'22','愛知':'23','三重':'24','滋賀':'25','京都':'26',
  '大阪':'27','兵庫':'28','奈良':'29','和歌山':'30','鳥取':'31','島根':'32',
  '岡山':'33','広島':'34','山口':'35','徳島':'36','香川':'37','愛媛':'38','高知':'39',
  '福岡':'40','佐賀':'41','長崎':'42','熊本':'43','大分':'44','宮崎':'45','鹿児島':'46','沖縄':'47'
};

const CITY_CODES = {
  '横浜市鶴見区':'14101','横浜市神奈川区':'14102','横浜市西区':'14103','横浜市中区':'14104',
  '横浜市南区':'14105','横浜市保土ケ谷区':'14106','横浜市磯子区':'14107','横浜市金沢区':'14108',
  '横浜市港北区':'14109','横浜市戸塚区':'14110','横浜市港南区':'14111','横浜市旭区':'14112',
  '横浜市緑区':'14113','横浜市瀬谷区':'14114','横浜市栄区':'14115','横浜市泉区':'14116',
  '横浜市青葉区':'14117','横浜市都筑区':'14118',
  '川崎市川崎区':'14131','川崎市幸区':'14132','川崎市中原区':'14133','川崎市高津区':'14134',
  '川崎市多摩区':'14135','川崎市宮前区':'14136','川崎市麻生区':'14137',
  '相模原市緑区':'14151','相模原市中央区':'14152','相模原市南区':'14153',
  '横須賀市':'14201','平塚市':'14203','鎌倉市':'14204','藤沢市':'14205','小田原市':'14206',
  '千代田区':'13101','中央区':'13102','港区':'13103','新宿区':'13104','文京区':'13105',
  '台東区':'13106','墨田区':'13107','江東区':'13108','品川区':'13109','目黒区':'13110',
  '大田区':'13111','世田谷区':'13112','渋谷区':'13113','中野区':'13114','杉並区':'13115',
  '豊島区':'13116','北区':'13117','荒川区':'13118','板橋区':'13119','練馬区':'13120',
  '足立区':'13121','葛飾区':'13122','江戸川区':'13123',
  '大阪市北区':'27102','大阪市中央区':'27109','大阪市西区':'27106','大阪市天王寺区':'27108',
  '大阪市浪速区':'27107','大阪市福島区':'27101',
  '名古屋市千種区':'23101','名古屋市東区':'23102','名古屋市中区':'23106',
  '名古屋市緑区':'23114','名古屋市名東区':'23115',
  '福岡市博多区':'40132','福岡市中央区':'40133','福岡市南区':'40134','福岡市西区':'40135'
};

// 物件タイプ → 国交省APIの種別キーワード
const TYPE_KEYWORDS = {
  'mansion':       ['中古マンション等','マンション'],
  'mansion-whole': ['中古マンション等','マンション'],
  'house':         ['中古一戸建て等','一戸建て','宅地(土地と建物)'],
  'land':          ['宅地(土地)','土地']
};

function extractPrefCode(address) {
  for (const [name, code] of Object.entries(PREF_CODES)) {
    if (address.includes(name)) return code;
  }
  return '13';
}

function extractCityCode(address) {
  const sorted = Object.entries(CITY_CODES).sort((a,b) => b[0].length - a[0].length);
  for (const [name, code] of sorted) {
    if (address.includes(name)) return code;
  }
  return null;
}

function httpsGet(reqUrl, headers) {
  return new Promise((resolve, reject) => {
    https.get(reqUrl, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error(`Parse error (${res.statusCode}): ${data.slice(0,200)}`)); }
      });
    }).on('error', reject);
  });
}

// 改善4: UnitPriceゼロ時はTradePrice/Areaで自前計算
function normalizeTransaction(raw) {
  const price = parseInt(raw.TradePrice) || 0;
  const area  = parseFloat(raw.Area) || 0;
  let unitRaw = parseInt(raw.UnitPrice) || 0;
  if (unitRaw === 0 && price > 0 && area > 0) {
    unitRaw = Math.round(price / area);
  }
  return {
    priceMan:     Math.round(price / 10000),
    unitPriceMan: Math.round(unitRaw / 10000 * 10) / 10,
    area,
    floorPlan:    raw.FloorPlan    || '',
    buildingYear: raw.BuildingYear || '',
    structure:    raw.Structure    || '',
    period:       raw.Period       || '',
    district:     raw.DistrictName || '',
    renovation:   raw.Renovation   || '',
    type:         raw.Type         || ''
  };
}

// 改善2: IQR法で外れ値を除外
function removeOutliers(values) {
  if (values.length < 6) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  return values.filter(v => v >= lower && v <= upper);
}

function calcStats(transactions) {
  // ソートキーを固定（period降順→unitPrice昇順）して毎回同じ結果になるよう安定化
  const sorted = [...transactions].sort((a, b) => {
    if (b.period !== a.period) return b.period.localeCompare(a.period);
    return a.unitPriceMan - b.unitPriceMan;
  });
  const rawUnits = sorted.map(t => t.unitPriceMan).filter(u => u > 0);
  const units    = removeOutliers(rawUnits).sort((a, b) => a - b);
  if (!units.length) return null;
  return {
    median:          units[Math.floor(units.length / 2)],
    mean:            Math.round(units.reduce((a, b) => a + b, 0) / units.length * 10) / 10,
    min:             units[0],
    max:             units[units.length - 1],
    count:           units.length,
    rawCount:        rawUnits.length,
    outliersRemoved: rawUnits.length - units.length
  };
}

// 改善5: 補正係数をサーバー側で計算して価格に反映
function calcAdjustmentFactors({ age, floor, direction, stationMin, reform, condition, propertyType }) {
  const ageFactor    = propertyType !== 'land' ? Math.max(0.45, 1 - (age || 0) * 0.012) : 1.0;
  const floorMap     = { '1': 0.92, '2': 0.97, '3': 1.02, '4': 1.08 };
  const floorFactor  = propertyType === 'mansion' ? (floorMap[floor] || 1.0) : 1.0;
  const dirMap       = { 'S': 1.05, 'SE': 1.03, 'SW': 1.02, 'E': 0.99, 'W': 0.97, 'N': 0.93 };
  const dirFactor    = propertyType === 'mansion' ? (dirMap[direction] || 1.0) : 1.0;
  const stationFactor = propertyType !== 'land'
    ? Math.max(0.80, 1 - ((stationMin || 10) - 5) * 0.012) : 1.0;
  const reformMap    = { 'none': 1.0, 'partial': 1.03, 'full': 1.07 };
  const reformFactor = reformMap[reform] || 1.0;
  const condMap      = { 'good': 1.02, 'normal': 1.0, 'poor': 0.93 };
  const condFactor   = condMap[condition] || 1.0;

  const total = ageFactor * floorFactor * dirFactor * stationFactor * reformFactor * condFactor;
  return { ageFactor, floorFactor, dirFactor, stationFactor, reformFactor, condFactor, total };
}

// 改善6: 地価公示データを取得
async function fetchLandPrice(prefCode, cityCode, apiKey) {
  try {
    const params = new URLSearchParams({ prefCode });
    if (cityCode) params.set('cityCode', cityCode);
    const res = await httpsGet(
      `${BASE_URL}/XIT002?${params.toString()}`,
      { 'X-API-KEY': apiKey }
    );
    if (res.body?.data?.length) {
      const prices = res.body.data
        .map(d => parseInt(d.Price) || 0)
        .filter(p => p > 0);
      if (prices.length) {
        const sorted = prices.sort((a, b) => a - b);
        return {
          median:   sorted[Math.floor(sorted.length / 2)],
          mean:     Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
          count:    prices.length
        };
      }
    }
  } catch(e) {
    console.error('landPrice fetch error:', e.message);
  }
  return null;
}

async function fetchTransactions(prefCode, cityCode, area, propertyType, apiKey) {
  const now      = new Date();
  const keywords = TYPE_KEYWORDS[propertyType] || TYPE_KEYWORDS['mansion'];
  let all        = [];

  for (let q = 0; q < 8 && all.length < 40; q++) {
    const d       = new Date(now);
    d.setMonth(d.getMonth() - q * 3);
    const year    = d.getFullYear();
    const quarter = Math.ceil((d.getMonth() + 1) / 3);

    for (const priceClass of ['02', '01']) {
      const params = new URLSearchParams({
        year, quarter, priceClassification: priceClass
      });
      if (cityCode) { params.set('city', cityCode); }
      else          { params.set('prefecture', prefCode); }

      try {
        const res = await httpsGet(
          `${BASE_URL}/XIT001?${params.toString()}`,
          { 'X-API-KEY': apiKey }
        );
        if (res.body?.data?.length) {
          // 改善1: 物件タイプでフィルタリング
          const filtered = res.body.data.filter(d =>
            keywords.some(kw => (d.Type || '').includes(kw))
          );
          console.log(`q=${q} pc=${priceClass} total=${res.body.data.length} typeFiltered=${filtered.length}`);
          all.push(...filtered.map(normalizeTransaction));
        }
      } catch(e) {
        console.error(`fetch error q=${q}:`, e.message);
      }
    }
  }

  // 改善3: 面積フィルタを±30%に精緻化
  const filtered = all.filter(t =>
    t.unitPriceMan > 0 &&
    t.area >= area * 0.70 &&
    t.area <= area * 1.30
  );
  // フィルタ後が3件未満なら±50%に緩和
  if (filtered.length >= 3) return filtered;
  return all.filter(t =>
    t.unitPriceMan > 0 &&
    t.area >= area * 0.50 &&
    t.area <= area * 1.50
  );
}

function generateMock(address, area, propertyType, adjustments) {
  const regionBase = {
    '青葉区': 72, '都筑区': 68, '港北区': 80, '川崎': 85, '横浜': 75,
    '港区': 175, '渋谷区': 170, '世田谷区': 118, '目黒区': 135,
    '大阪': 73, '名古屋': 63, '福岡': 58, '京都': 68
  };
  const typeDiscount = { 'mansion': 1.0, 'mansion-whole': 0.85, 'house': 0.70, 'land': 0.55 };
  let base = 65;
  for (const [k, v] of Object.entries(regionBase)) {
    if (address.includes(k)) { base = v; break; }
  }
  base = Math.round(base * (typeDiscount[propertyType] || 1.0));

  const now = new Date();
  const layouts = ['1LDK', '2LDK', '2LDK', '3LDK', '3LDK', '1R'];
  const transactions = Array.from({ length: 12 }, (_, i) => {
    const a = Math.round(area * (0.75 + Math.random() * 0.5));
    const u = Math.round(base * (0.82 + Math.random() * 0.36) * 10) / 10;
    const d = new Date(now);
    d.setMonth(d.getMonth() - Math.floor(i * 2.5));
    return {
      priceMan: Math.round(u * a), unitPriceMan: u, area: a,
      floorPlan: layouts[i % 6],
      buildingYear: `${2000 + Math.floor(Math.random() * 24)}年`,
      structure: 'RC',
      period: `${d.getFullYear()}年第${Math.ceil((d.getMonth() + 1) / 3)}四半期`,
      district: '', renovation: i % 4 === 0 ? '改装済み' : ''
    };
  });
  const stats = calcStats(transactions);
  const basePrice = Math.round((stats?.median || base) * area);
  const adjPrice  = Math.round(basePrice * (adjustments?.total || 1.0));
  return {
    isMock: true, transactions, stats,
    estimatedUnitPrice: stats?.median || base,
    estimatedPrice: adjPrice,
    adjustments
  };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const { address, propertyType, area, landArea,
            age, floor, direction, stationMin, reform, condition } = body;

    if (!address) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: '住所と面積は必須です' }) };
    }
    // 面積チェック: 物件タイプ別に使用する面積が異なる
    const hasArea = area > 0 || landArea > 0;
    if (!hasArea) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: '住所と面積は必須です' }) };
    }

    const apiKey   = process.env.REINFOLIB_API_KEY || '';
    const prefCode = extractPrefCode(address);
    const cityCode = extractCityCode(address);

    // 改善5: 補正係数をサーバーで計算
    const adjustments = calcAdjustmentFactors({
      age, floor, direction, stationMin, reform, condition, propertyType
    });

    // 土地・戸建て・一棟では土地面積を優先使用
    const calcArea = (propertyType === 'land' || propertyType === 'house' || propertyType === 'mansion-whole')
      ? (landArea || area) : area;

    console.log(`address=${address} pref=${prefCode} city=${cityCode} type=${propertyType} area=${calcArea} adj=${adjustments.total.toFixed(3)}`);

    let result;
    if (!apiKey) {
      result = generateMock(address, calcArea, propertyType, adjustments);
    } else {
      // 戸建ての場合は土地取引データも並行取得（土地㎡単価の分離計算に使用）
      const fetchLandTx = (propertyType === 'house')
        ? fetchTransactions(prefCode, cityCode, calcArea, 'land', apiKey)
        : Promise.resolve([]);

      const [transactions, landPriceData, landTxForHouse] = await Promise.all([
        fetchTransactions(prefCode, cityCode, calcArea, propertyType, apiKey),
        (propertyType !== 'mansion')
          ? fetchLandPrice(prefCode, cityCode, apiKey)
          : Promise.resolve(null),
        fetchLandTx
      ]);

      const stats = calcStats(transactions);
      if (!stats) {
        result = { ...generateMock(address, calcArea, propertyType, adjustments), fallback: true };
      } else {

        let finalPrice, estimatedUnitPrice, breakdown = null;

        if (propertyType === 'house') {
          // ── 戸建て: 土地 + 建物 の分離計算 ──
          // 土地㎡単価: 土地取引データの中央値（なければ地価公示）
          const landStats   = calcStats(landTxForHouse);
          const landUnitMan = landStats
            ? landStats.median
            : (landPriceData ? Math.round(landPriceData.median / 10000) : stats.median * 0.7);

          const floorAreaVal = body.floorArea || calcArea * 1.2; // 延床面積（未入力なら土地の1.2倍で推定）
          const ageVal       = age || 0;

          // 建物残存価値: RC法定耐用年数47年、木造22年（戸建ては木造想定）
          const legalLife    = 22;
          const remainRatio  = Math.max(0.1, (legalLife - ageVal) / legalLife);
          // 建物再調達原価: 木造戸建て約18万円/㎡
          const buildUnitMan = 18;
          const buildValue   = Math.round(floorAreaVal * buildUnitMan * remainRatio);
          const landValue    = Math.round(landUnitMan * calcArea);

          finalPrice         = Math.round((landValue + buildValue) * (adjustments.condFactor || 1.0) * (adjustments.reformFactor || 1.0));
          estimatedUnitPrice = Math.round(finalPrice / calcArea * 10) / 10;

          breakdown = {
            landUnitMan, landValue,
            buildUnitMan, floorArea: Math.round(floorAreaVal),
            remainRatio: Math.round(remainRatio * 100), buildValue
          };
          console.log(`house calc: land=${landValue} build=${buildValue} total=${finalPrice}`);

        } else {
          // ── マンション・土地・一棟: 取引比較法 ──
          const baseUnitPrice  = stats.median;
          const adjUnitPrice   = Math.round(baseUnitPrice * adjustments.total * 10) / 10;
          const estimatedPrice = Math.round(adjUnitPrice * calcArea);
          estimatedUnitPrice   = adjUnitPrice;

          // 地価公示との加重平均（土地・一棟のみ）
          finalPrice = estimatedPrice;
          let landPriceUsed = false;
          if (landPriceData && landPriceData.median > 0 && propertyType !== 'mansion') {
            const landUnitMan = Math.round(landPriceData.median / 10000);
            const landTotal   = landUnitMan * calcArea;
            finalPrice    = Math.round(estimatedPrice * 0.7 + landTotal * 0.3);
            landPriceUsed = true;
            console.log(`landPrice used: unitMan=${landUnitMan} total=${finalPrice}`);
          }
          result = {
            isMock: false, prefCode, cityCode, address, propertyType,
            transactions: transactions.slice(0, 15), stats,
            estimatedUnitPrice, estimatedPrice: finalPrice,
            adjustments,
            landPriceData: landPriceData ? { median: Math.round(landPriceData.median / 10000), count: landPriceData.count } : null,
            landPriceUsed, breakdown: null
          };
          return { statusCode: 200, headers, body: JSON.stringify(result) };
        }

        result = {
          isMock: false, prefCode, cityCode, address, propertyType,
          transactions: transactions.slice(0, 15), stats,
          estimatedUnitPrice, estimatedPrice: finalPrice,
          adjustments,
          landPriceData: landPriceData ? { median: Math.round(landPriceData.median / 10000), count: landPriceData.count } : null,
          landPriceUsed: !!landPriceData, breakdown
        };
      }
    }
    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch(e) {
    console.error('Function error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
