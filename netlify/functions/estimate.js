/**
 * Netlify Function: estimate
 * 国交省 不動産情報ライブラリ API プロキシ
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
  '名古屋市千種区':'23101','名古屋市東区':'23102','名古屋市中区':'23106','名古屋市緑区':'23114',
  '福岡市博多区':'40132','福岡市中央区':'40133','福岡市南区':'40134','福岡市西区':'40135'
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
        catch(e) { reject(new Error(`Parse error (${res.statusCode}): ${data.slice(0,300)}`)); }
      });
    }).on('error', reject);
  });
}

function normalizeTransaction(raw) {
  const price   = parseInt(raw.TradePrice) || 0;
  const unitRaw = parseInt(raw.UnitPrice)  || 0;
  return {
    priceMan:     Math.round(price / 10000),
    unitPriceMan: Math.round(unitRaw / 10000 * 10) / 10,
    area:         parseFloat(raw.Area)   || 0,
    floorPlan:    raw.FloorPlan          || '',
    buildingYear: raw.BuildingYear       || '',
    structure:    raw.Structure          || '',
    period:       raw.Period             || '',
    district:     raw.DistrictName       || '',
    renovation:   raw.Renovation         || '',
    type:         raw.Type               || ''
  };
}

function calcStats(transactions) {
  const units = transactions.map(t => t.unitPriceMan).filter(u => u > 0).sort((a,b) => a-b);
  if (!units.length) return null;
  return {
    median: units[Math.floor(units.length / 2)],
    mean:   Math.round(units.reduce((a,b) => a+b, 0) / units.length * 10) / 10,
    min:    units[0],
    max:    units[units.length - 1],
    count:  units.length
  };
}

async function fetchTransactions(prefCode, cityCode, area, apiKey) {
  const now = new Date();
  let all = [];

  for (let q = 0; q < 8 && all.length < 30; q++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - q * 3);
    const year    = d.getFullYear();
    const quarter = Math.ceil((d.getMonth() + 1) / 3);

    for (const priceClass of ['02', '01']) {
      const params = new URLSearchParams({
        year:                String(year),
        quarter:             String(quarter),
        priceClassification: priceClass
      });
      if (cityCode) {
        params.set('city', cityCode);
      } else {
        params.set('prefecture', prefCode);
      }

      try {
        const res = await httpsGet(
          `${BASE_URL}/XIT001?${params.toString()}`,
          { 'X-API-KEY': apiKey }
        );
        console.log(`q=${q} pc=${priceClass} status=${res.status} count=${res.body?.data?.length||0}`);
        if (res.body?.data?.length) {
          all.push(...res.body.data.map(normalizeTransaction));
        }
      } catch(e) {
        console.error(`fetch error:`, e.message);
      }
    }
  }

  const filtered = all.filter(t =>
    t.unitPriceMan > 0 && t.area >= area * 0.4 && t.area <= area * 1.6
  );
  return filtered.length >= 3 ? filtered : all.filter(t => t.unitPriceMan > 0);
}

function generateMock(address, area) {
  const regionBase = {
    '青葉区':72,'都筑区':68,'港北区':80,'川崎':85,'横浜':75,
    '港区':175,'渋谷区':170,'世田谷区':118,'大阪':73,'名古屋':63,'福岡':58
  };
  let base = 65;
  for (const [k,v] of Object.entries(regionBase)) {
    if (address.includes(k)) { base = v; break; }
  }
  const now = new Date();
  const layouts = ['1LDK','2LDK','2LDK','3LDK','3LDK','1R'];
  const transactions = Array.from({length:12},(_,i) => {
    const a = Math.round(area * (0.75 + Math.random()*0.5));
    const u = Math.round(base * (0.82 + Math.random()*0.36) * 10)/10;
    const d = new Date(now); d.setMonth(d.getMonth() - Math.floor(i*2.5));
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
    estimatedUnitPrice: stats?.median||base,
    estimatedPrice: Math.round((stats?.median||base)*area) };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers, body:'' };
  if (event.httpMethod !== 'POST')    return { statusCode:405, headers, body:JSON.stringify({error:'Method not allowed'}) };

  try {
    const { address, propertyType, area } = JSON.parse(event.body || '{}');
    if (!address || !area) return { statusCode:400, headers, body:JSON.stringify({error:'住所と面積は必須です'}) };

    const apiKey   = process.env.REINFOLIB_API_KEY || '';
    const prefCode = extractPrefCode(address);
    const cityCode = extractCityCode(address);
    console.log(`address=${address} pref=${prefCode} city=${cityCode} apiKey=${apiKey?'SET':'NONE'}`);

    let result;
    if (!apiKey) {
      result = generateMock(address, area);
    } else {
      const transactions = await fetchTransactions(prefCode, cityCode, area, apiKey);
      const stats = calcStats(transactions);
      if (!stats) {
        result = { ...generateMock(address, area), fallback:true,
          message:'この地域の取引データが少ないため参考値で表示しています' };
      } else {
        result = {
          isMock:false, prefCode, cityCode, address, propertyType,
          transactions: transactions.slice(0,15), stats,
          estimatedUnitPrice: stats.median,
          estimatedPrice: Math.round(stats.median * area)
        };
      }
    }
    return { statusCode:200, headers, body:JSON.stringify(result) };

  } catch(e) {
    console.error('Function error:', e);
    return { statusCode:500, headers, body:JSON.stringify({error:e.message}) };
  }
};
