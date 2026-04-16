/**
 * Netlify Function: estimate
 * エンドポイント: /api/estimate  (netlify.toml でリダイレクト設定済み)
 *
 * 国交省 不動産情報ライブラリAPIへのプロキシ。
 * APIキーは Netlify の環境変数 REINFOLIB_API_KEY に設定する。
 */

const https = require('https');

const BASE_URL = 'https://www.reinfolib.mlit.go.jp/ex-api/external';

// ── 都道府県コード ──
const PREF_CODES = {
  '北海道':1,'青森':2,'岩手':3,'宮城':4,'秋田':5,'山形':6,'福島':7,
  '茨城':8,'栃木':9,'群馬':10,'埼玉':11,'千葉':12,'東京':13,'神奈川':14,
  '新潟':15,'富山':16,'石川':17,'福井':18,'山梨':19,'長野':20,
  '岐阜':21,'静岡':22,'愛知':23,'三重':24,'滋賀':25,'京都':26,
  '大阪':27,'兵庫':28,'奈良':29,'和歌山':30,'鳥取':31,'島根':32,
  '岡山':33,'広島':34,'山口':35,'徳島':36,'香川':37,'愛媛':38,'高知':39,
  '福岡':40,'佐賀':41,'長崎':42,'熊本':43,'大分':44,'宮崎':45,'鹿児島':46,'沖縄':47
};

function extractPrefCode(address) {
  for (const [name, code] of Object.entries(PREF_CODES)) {
    if (address.includes(name)) return String(code).padStart(2, '0');
  }
  return '13';
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error(`Parse error (${res.statusCode}): ${data.slice(0,200)}`)); }
      });
    }).on('error', reject);
  });
}

function normalizeTransaction(raw) {
  const price    = parseInt(raw.TradePrice) || 0;
  const unitRaw  = parseInt(raw.UnitPrice)  || 0;
  return {
    priceMan:     Math.round(price / 10000),
    unitPriceMan: Math.round(unitRaw / 10000 * 10) / 10,
    area:         parseFloat(raw.Area)         || 0,
    floorPlan:    raw.FloorPlan                || '',
    buildingYear: raw.BuildingYear             || '',
    structure:    raw.Structure                || '',
    period:       raw.Period                   || '',
    district:     raw.DistrictName             || '',
    renovation:   raw.Renovation               || '',
    type:         raw.Type                     || ''
  };
}

function calcStats(transactions) {
  const units = transactions.map(t => t.unitPriceMan).filter(u => u > 0).sort((a,b)=>a-b);
  const totals = transactions.map(t => t.priceMan).filter(p => p > 0);
  if (!units.length) return null;
  return {
    median:    units[Math.floor(units.length / 2)],
    mean:      Math.round(units.reduce((a,b)=>a+b,0) / units.length * 10) / 10,
    min:       units[0],
    max:       units[units.length - 1],
    totalMean: totals.length ? Math.round(totals.reduce((a,b)=>a+b,0) / totals.length) : 0,
    count:     units.length
  };
}

async function fetchTransactions(prefCode, area, propertyType, apiKey) {
  const now = new Date();
  let all = [];

  // 直近4四半期を取得（成約価格優先 → 取引価格も補完）
  for (let q = 0; q < 4; q++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - q * 3);
    const year    = d.getFullYear();
    const quarter = Math.ceil((d.getMonth() + 1) / 3);
    const params  = new URLSearchParams({
      year:                String(year),
      quarter:             String(quarter),
      area:                prefCode,
      priceClassification: '02'   // 成約価格
    });
    try {
      const res = await httpsGet(
        `${BASE_URL}/XIT001?${params}`,
        { 'X-API-KEY': apiKey }
      );
      if (res.body?.data) all.push(...res.body.data.map(normalizeTransaction));
    } catch(e) {
      console.error(`Q${quarter} ${year} fetch error:`, e.message);
    }
  }

  // データ不足なら取引価格も追加
  if (all.length < 10) {
    for (let q = 0; q < 2; q++) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - q * 3);
      const params = new URLSearchParams({
        year:    String(d.getFullYear()),
        quarter: String(Math.ceil((d.getMonth()+1)/3)),
        area:    prefCode,
        priceClassification: '01'
      });
      try {
        const res = await httpsGet(
          `${BASE_URL}/XIT001?${params}`,
          { 'X-API-KEY': apiKey }
        );
        if (res.body?.data) all.push(...res.body.data.map(normalizeTransaction));
      } catch(e) { /* skip */ }
    }
  }

  // 面積フィルタ (±50%)
  const filtered = all.filter(t =>
    t.unitPriceMan > 0 &&
    t.area >= area * 0.5 &&
    t.area <= area * 1.5
  );
  return filtered.length >= 5 ? filtered : all.filter(t => t.unitPriceMan > 0);
}

// ── モックデータ ──
function generateMock(address, area) {
  const regionBase = {
    '港区':175,'渋谷区':170,'千代田区':160,'中央区':150,'新宿区':145,
    '目黒区':135,'品川区':128,'世田谷区':118,'豊島区':112,'文京区':132,
    '横浜':78,'大阪':73,'名古屋':63,'福岡':58,'京都':68
  };
  let base = 68;
  for (const [k,v] of Object.entries(regionBase)) if (address.includes(k)) { base=v; break; }

  const now = new Date();
  const layouts = ['1LDK','2LDK','2LDK','3LDK','3LDK','1R'];
  const transactions = Array.from({length:12},(_,i)=>{
    const av = 0.75 + Math.random()*0.5;
    const pv = 0.82 + Math.random()*0.36;
    const a  = Math.round(area * av);
    const u  = Math.round(base * pv * 10)/10;
    const d  = new Date(now); d.setMonth(d.getMonth() - Math.floor(i*2.5));
    return {
      priceMan: Math.round(u*a), unitPriceMan: u, area: a,
      floorPlan: layouts[i%6],
      buildingYear:`${2000+Math.floor(Math.random()*24)}年`,
      structure:'RC',
      period:`${d.getFullYear()}年第${Math.ceil((d.getMonth()+1)/3)}四半期`,
      district:'', renovation: i%4===0?'改装済み':''
    };
  });
  const stats = calcStats(transactions);
  return { isMock:true, transactions, stats,
    estimatedUnitPrice: stats?.median || base,
    estimatedPrice: Math.round((stats?.median || base) * area) };
}

// ── Netlify Function ハンドラー ──
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { address, propertyType, area } = JSON.parse(event.body || '{}');
    if (!address || !area) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: '住所と面積は必須です' }) };
    }

    const apiKey   = process.env.REINFOLIB_API_KEY || '';
    const prefCode = extractPrefCode(address);

    let transactions, stats, estimatedUnitPrice, estimatedPrice, isMock;

    if (!apiKey) {
      // モックモード
      const mock = generateMock(address, area);
      ({ isMock, transactions, stats, estimatedUnitPrice, estimatedPrice } = mock);
    } else {
      // 実APIモード
      isMock       = false;
      transactions = await fetchTransactions(prefCode, area, propertyType, apiKey);
      stats        = calcStats(transactions);
      if (!stats) throw new Error('この地域の取引データが見つかりませんでした');
      estimatedUnitPrice = stats.median;
      estimatedPrice     = Math.round(stats.median * area);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        isMock, prefCode, address, propertyType,
        transactions: transactions.slice(0, 15),
        stats, estimatedUnitPrice, estimatedPrice
      })
    };

  } catch(e) {
    console.error('Function error:', e);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message })
    };
  }
};
