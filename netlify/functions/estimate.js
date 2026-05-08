/**
 * Netlify Function: estimate v4
 *
 * 査定ロジック:
 *  1. 町丁目係数（300地区）をベース価格とする
 *  2. 国交省APIの取引データを取得し、信頼度に応じて加重平均
 *  3. 戸建ては原価法（土地は係数+API、建物は再調達原価×残存率）
 *  4. 補正係数を最終価格に乗算
 *  5. 結果に「土地+建物の内訳」を含める
 */

const https = require('https');
const BASE_URL = 'https://www.reinfolib.mlit.go.jp/ex-api/external';

// ============================================================
// 町丁目係数データベース（300地区）
// ============================================================
const TOWN_COEFFICIENTS = {
  // ============== 東京23区 (約100地区) ==============
  // 港区
  '港区赤坂':       { mansion: 480, land: 380 },
  '港区青山':       { mansion: 540, land: 420 },
  '港区南青山':     { mansion: 540, land: 420 },
  '港区北青山':     { mansion: 480, land: 360 },
  '港区六本木':     { mansion: 460, land: 350 },
  '港区西麻布':     { mansion: 470, land: 360 },
  '港区元麻布':     { mansion: 480, land: 380 },
  '港区南麻布':     { mansion: 460, land: 360 },
  '港区東麻布':     { mansion: 410, land: 320 },
  '港区麻布':       { mansion: 470, land: 360 },
  '港区白金':       { mansion: 380, land: 290 },
  '港区白金台':     { mansion: 410, land: 320 },
  '港区高輪':       { mansion: 360, land: 270 },
  '港区三田':       { mansion: 350, land: 270 },
  '港区芝':         { mansion: 320, land: 240 },
  '港区芝浦':       { mansion: 280, land: 200 },
  '港区台場':       { mansion: 230, land: 170 },
  '港区港南':       { mansion: 270, land: 200 },
  '港区':           { mansion: 380, land: 290 },

  // 千代田区
  '千代田区番町':   { mansion: 460, land: 360 },
  '千代田区一番町': { mansion: 520, land: 400 },
  '千代田区二番町': { mansion: 480, land: 380 },
  '千代田区三番町': { mansion: 480, land: 380 },
  '千代田区四番町': { mansion: 460, land: 360 },
  '千代田区五番町': { mansion: 460, land: 360 },
  '千代田区六番町': { mansion: 460, land: 360 },
  '千代田区麹町':   { mansion: 430, land: 330 },
  '千代田区九段':   { mansion: 380, land: 290 },
  '千代田区神田':   { mansion: 280, land: 210 },
  '千代田区':       { mansion: 380, land: 290 },

  // 中央区
  '中央区銀座':     { mansion: 480, land: 380 },
  '中央区日本橋':   { mansion: 360, land: 280 },
  '中央区八丁堀':   { mansion: 280, land: 210 },
  '中央区月島':     { mansion: 280, land: 210 },
  '中央区勝どき':   { mansion: 290, land: 220 },
  '中央区晴海':     { mansion: 280, land: 210 },
  '中央区豊海':     { mansion: 270, land: 200 },
  '中央区佃':       { mansion: 270, land: 200 },
  '中央区築地':     { mansion: 320, land: 240 },
  '中央区':         { mansion: 320, land: 240 },

  // 渋谷区
  '渋谷区松濤':     { mansion: 480, land: 380 },
  '渋谷区広尾':     { mansion: 440, land: 340 },
  '渋谷区代々木上原':{ mansion: 380, land: 290 },
  '渋谷区代々木':   { mansion: 320, land: 240 },
  '渋谷区代々木公園':{ mansion: 380, land: 290 },
  '渋谷区上原':     { mansion: 380, land: 290 },
  '渋谷区恵比寿':   { mansion: 400, land: 310 },
  '渋谷区恵比寿西': { mansion: 380, land: 290 },
  '渋谷区恵比寿南': { mansion: 360, land: 270 },
  '渋谷区神宮前':   { mansion: 460, land: 360 },
  '渋谷区表参道':   { mansion: 480, land: 380 },
  '渋谷区代官山':   { mansion: 460, land: 360 },
  '渋谷区猿楽町':   { mansion: 460, land: 360 },
  '渋谷区鉢山町':   { mansion: 440, land: 340 },
  '渋谷区道玄坂':   { mansion: 320, land: 240 },
  '渋谷区':         { mansion: 380, land: 290 },

  // 新宿区
  '新宿区市谷':     { mansion: 320, land: 240 },
  '新宿区四谷':     { mansion: 320, land: 240 },
  '新宿区神楽坂':   { mansion: 340, land: 260 },
  '新宿区西新宿':   { mansion: 320, land: 240 },
  '新宿区高田馬場': { mansion: 240, land: 180 },
  '新宿区落合':     { mansion: 220, land: 165 },
  '新宿区下落合':   { mansion: 230, land: 175 },
  '新宿区中井':     { mansion: 210, land: 160 },
  '新宿区':         { mansion: 280, land: 210 },

  // 目黒区
  '目黒区中目黒':   { mansion: 320, land: 240 },
  '目黒区青葉台':   { mansion: 340, land: 260 },
  '目黒区上目黒':   { mansion: 290, land: 220 },
  '目黒区東山':     { mansion: 290, land: 220 },
  '目黒区下目黒':   { mansion: 270, land: 200 },
  '目黒区目黒':     { mansion: 280, land: 210 },
  '目黒区自由が丘': { mansion: 290, land: 220 },
  '目黒区八雲':     { mansion: 280, land: 210 },
  '目黒区柿の木坂': { mansion: 280, land: 210 },
  '目黒区祐天寺':   { mansion: 250, land: 190 },
  '目黒区学芸大学': { mansion: 240, land: 180 },
  '目黒区鷹番':     { mansion: 250, land: 190 },
  '目黒区':         { mansion: 270, land: 200 },

  // 文京区
  '文京区本郷':     { mansion: 290, land: 220 },
  '文京区小石川':   { mansion: 270, land: 200 },
  '文京区目白台':   { mansion: 290, land: 220 },
  '文京区千駄木':   { mansion: 240, land: 180 },
  '文京区根津':     { mansion: 230, land: 175 },
  '文京区白山':     { mansion: 240, land: 180 },
  '文京区音羽':     { mansion: 290, land: 220 },
  '文京区関口':     { mansion: 290, land: 220 },
  '文京区後楽':     { mansion: 320, land: 240 },
  '文京区春日':     { mansion: 290, land: 220 },
  '文京区':         { mansion: 270, land: 200 },

  // 品川区
  '品川区五反田':   { mansion: 280, land: 210 },
  '品川区大崎':     { mansion: 270, land: 200 },
  '品川区大井':     { mansion: 220, land: 165 },
  '品川区戸越':     { mansion: 220, land: 165 },
  '品川区西五反田': { mansion: 290, land: 220 },
  '品川区東五反田': { mansion: 290, land: 220 },
  '品川区上大崎':   { mansion: 320, land: 240 },
  '品川区武蔵小山': { mansion: 240, land: 180 },
  '品川区中延':     { mansion: 220, land: 165 },
  '品川区荏原':     { mansion: 220, land: 165 },
  '品川区東品川':   { mansion: 240, land: 180 },
  '品川区南品川':   { mansion: 220, land: 165 },
  '品川区':         { mansion: 240, land: 180 },

  // 世田谷区
  '世田谷区成城':   { mansion: 290, land: 220 },
  '世田谷区用賀':   { mansion: 240, land: 180 },
  '世田谷区瀬田':   { mansion: 250, land: 190 },
  '世田谷区玉川':   { mansion: 240, land: 180 },
  '世田谷区二子玉川':{ mansion: 290, land: 220 },
  '世田谷区桜新町': { mansion: 240, land: 180 },
  '世田谷区三軒茶屋':{ mansion: 270, land: 200 },
  '世田谷区下北沢': { mansion: 280, land: 210 },
  '世田谷区代田':   { mansion: 240, land: 180 },
  '世田谷区代沢':   { mansion: 240, land: 180 },
  '世田谷区祖師谷': { mansion: 200, land: 150 },
  '世田谷区赤堤':   { mansion: 220, land: 165 },
  '世田谷区松原':   { mansion: 220, land: 165 },
  '世田谷区経堂':   { mansion: 220, land: 165 },
  '世田谷区上馬':   { mansion: 230, land: 175 },
  '世田谷区':       { mansion: 230, land: 175 },

  // 杉並区・中野区
  '杉並区荻窪':     { mansion: 220, land: 165 },
  '杉並区高円寺':   { mansion: 220, land: 165 },
  '杉並区阿佐ヶ谷': { mansion: 210, land: 160 },
  '杉並区西荻窪':   { mansion: 200, land: 150 },
  '杉並区永福':     { mansion: 210, land: 160 },
  '杉並区':         { mansion: 200, land: 150 },
  '中野区中野':     { mansion: 240, land: 180 },
  '中野区':         { mansion: 220, land: 165 },

  // 豊島区
  '豊島区池袋':     { mansion: 250, land: 190 },
  '豊島区目白':     { mansion: 290, land: 220 },
  '豊島区巣鴨':     { mansion: 200, land: 150 },
  '豊島区駒込':     { mansion: 220, land: 165 },
  '豊島区南池袋':   { mansion: 280, land: 210 },
  '豊島区北大塚':   { mansion: 200, land: 150 },
  '豊島区':         { mansion: 220, land: 165 },

  // 江東区
  '江東区豊洲':     { mansion: 280, land: 210 },
  '江東区有明':     { mansion: 220, land: 165 },
  '江東区東雲':     { mansion: 230, land: 175 },
  '江東区清澄':     { mansion: 230, land: 175 },
  '江東区門前仲町': { mansion: 240, land: 180 },
  '江東区木場':     { mansion: 220, land: 165 },
  '江東区':         { mansion: 200, land: 150 },

  // 台東区・墨田区・大田区
  '台東区上野':     { mansion: 230, land: 175 },
  '台東区浅草':     { mansion: 220, land: 165 },
  '台東区谷中':     { mansion: 220, land: 165 },
  '台東区':         { mansion: 220, land: 165 },
  '墨田区錦糸町':   { mansion: 220, land: 165 },
  '墨田区両国':     { mansion: 220, land: 165 },
  '墨田区押上':     { mansion: 220, land: 165 },
  '墨田区':         { mansion: 190, land: 145 },
  '大田区田園調布': { mansion: 290, land: 220 },
  '大田区雪谷':     { mansion: 200, land: 150 },
  '大田区蒲田':     { mansion: 180, land: 135 },
  '大田区大森':     { mansion: 200, land: 150 },
  '大田区':         { mansion: 190, land: 145 },

  // 北区・荒川区
  '北区赤羽':       { mansion: 180, land: 135 },
  '北区王子':       { mansion: 190, land: 145 },
  '北区':           { mansion: 170, land: 130 },
  '荒川区':         { mansion: 170, land: 130 },

  // 足立区・葛飾区・江戸川区
  '足立区北千住':   { mansion: 180, land: 135 },
  '足立区':         { mansion: 130, land: 100 },
  '葛飾区':         { mansion: 130, land: 100 },
  '江戸川区葛西':   { mansion: 170, land: 130 },
  '江戸川区':       { mansion: 140, land: 110 },

  // 練馬区・板橋区
  '練馬区光が丘':   { mansion: 170, land: 130 },
  '練馬区':         { mansion: 160, land: 120 },
  '板橋区':         { mansion: 160, land: 120 },

  // 中央区追加
  '中央区':         { mansion: 320, land: 240 },

  // ============== 横浜市 (約60地区) ==============
  // 横浜市青葉区
  '横浜市青葉区美しが丘':   { mansion: 100, land: 75 },
  '横浜市青葉区たまプラーザ':{ mansion: 100, land: 75 },
  '横浜市青葉区あざみ野':   { mansion: 95,  land: 71 },
  '横浜市青葉区新石川':     { mansion: 95,  land: 71 },
  '横浜市青葉区荏田西':     { mansion: 60,  land: 38 },
  '横浜市青葉区荏田北':     { mansion: 58,  land: 36 },
  '横浜市青葉区荏田':       { mansion: 58,  land: 36 },
  '横浜市青葉区市ヶ尾':     { mansion: 58,  land: 36 },
  '横浜市青葉区藤が丘':     { mansion: 70,  land: 50 },
  '横浜市青葉区青葉台':     { mansion: 65,  land: 45 },
  '横浜市青葉区桜台':       { mansion: 60,  land: 42 },
  '横浜市青葉区つつじが丘': { mansion: 60,  land: 42 },
  '横浜市青葉区田奈':       { mansion: 50,  land: 36 },
  '横浜市青葉区':           { mansion: 70,  land: 48 },

  // 横浜市都筑区
  '横浜市都筑区センター北': { mansion: 80, land: 56 },
  '横浜市都筑区センター南': { mansion: 80, land: 56 },
  '横浜市都筑区中川':       { mansion: 75, land: 52 },
  '横浜市都筑区茅ヶ崎':     { mansion: 70, land: 48 },
  '横浜市都筑区':           { mansion: 70, land: 48 },

  // 横浜市港北区
  '横浜市港北区日吉':       { mansion: 95, land: 70 },
  '横浜市港北区綱島':       { mansion: 80, land: 56 },
  '横浜市港北区新横浜':     { mansion: 80, land: 56 },
  '横浜市港北区菊名':       { mansion: 75, land: 52 },
  '横浜市港北区大倉山':     { mansion: 80, land: 56 },
  '横浜市港北区妙蓮寺':     { mansion: 75, land: 52 },
  '横浜市港北区':           { mansion: 75, land: 52 },

  // 横浜市中心部
  '横浜市中区元町':         { mansion: 130, land: 95 },
  '横浜市中区山手':         { mansion: 140, land: 105 },
  '横浜市中区みなとみらい': { mansion: 145, land: 110 },
  '横浜市中区関内':         { mansion: 100, land: 70 },
  '横浜市中区':             { mansion: 110, land: 80 },
  '横浜市西区みなとみらい': { mansion: 145, land: 110 },
  '横浜市西区':             { mansion: 105, land: 75 },
  '横浜市神奈川区東神奈川': { mansion: 80,  land: 56 },
  '横浜市神奈川区':         { mansion: 80,  land: 56 },

  // 横浜市その他
  '横浜市鶴見区':           { mansion: 70, land: 50 },
  '横浜市保土ケ谷区':       { mansion: 65, land: 45 },
  '横浜市磯子区':           { mansion: 60, land: 42 },
  '横浜市金沢区':           { mansion: 55, land: 38 },
  '横浜市港南区':           { mansion: 65, land: 45 },
  '横浜市戸塚区':           { mansion: 60, land: 42 },
  '横浜市旭区':             { mansion: 55, land: 38 },
  '横浜市瀬谷区':           { mansion: 50, land: 36 },
  '横浜市栄区':             { mansion: 55, land: 38 },
  '横浜市泉区':             { mansion: 50, land: 36 },
  '横浜市緑区':             { mansion: 60, land: 42 },
  '横浜市南区':             { mansion: 65, land: 45 },

  // ============== 兵庫県西宮市（町丁目レベル20地区） ==============
  // 西宮七園
  '西宮市甲陽園西山町':     { mansion: 22, land: 16 },
  '西宮市甲陽園東山町':     { mansion: 24, land: 17 },
  '西宮市甲陽園日之出町':   { mansion: 56, land: 39 },
  '西宮市甲陽園本庄町':     { mansion: 68, land: 47 },
  '西宮市甲陽園目神山町':   { mansion: 12, land: 7 },
  '西宮市甲陽園若江町':     { mansion: 60, land: 41 },
  '西宮市甲陽園':           { mansion: 50, land: 32 },
  '西宮市苦楽園一番町':     { mansion: 58, land: 40 },
  '西宮市苦楽園二番町':     { mansion: 56, land: 38 },
  '西宮市苦楽園':           { mansion: 55, land: 37 },
  '西宮市夙川':             { mansion: 90, land: 65 },
  '西宮市段上町':           { mansion: 50, land: 35 },
  '西宮市西宮北口':         { mansion: 100, land: 70 },
  '西宮市北口町':           { mansion: 100, land: 70 },
  '西宮市高松町':           { mansion: 130, land: 90 },
  '西宮市甲子園':           { mansion: 80, land: 56 },
  '西宮市甲子園口':         { mansion: 75, land: 52 },
  '西宮市鳴尾':             { mansion: 65, land: 45 },
  '西宮市香櫨園':           { mansion: 80, land: 56 },
  '西宮市上ケ原':           { mansion: 60, land: 42 },
  '西宮市山口':             { mansion: 30, land: 20 },
  '西宮市塩瀬':             { mansion: 40, land: 28 },
  '西宮市名塩':             { mansion: 18, land: 12 },
  '西宮市':                 { mansion: 70, land: 50 },

  // ============== 兵庫県宝塚市（町丁目レベル10地区） ==============
  '宝塚市逆瀬川':           { mansion: 75, land: 52 },
  '宝塚市清荒神':           { mansion: 65, land: 45 },
  '宝塚市売布':             { mansion: 65, land: 45 },
  '宝塚市山本':             { mansion: 55, land: 38 },
  '宝塚市山本台':           { mansion: 50, land: 35 },
  '宝塚市中山':             { mansion: 70, land: 48 },
  '宝塚市雲雀丘':           { mansion: 85, land: 60 },
  '宝塚市花屋敷':           { mansion: 85, land: 60 },
  '宝塚市武庫が丘':         { mansion: 60, land: 42 },
  '宝塚市すみれが丘':       { mansion: 60, land: 42 },
  '宝塚市御殿山':           { mansion: 60, land: 42 },
  '宝塚市仁川':             { mansion: 70, land: 48 },
  '宝塚市':                 { mansion: 65, land: 45 }
};

function lookupCoefficient(address, propertyType) {
  const sorted = Object.entries(TOWN_COEFFICIENTS).sort((a,b) => b[0].length - a[0].length);
  for (const [name, coef] of sorted) {
    if (address.includes(name)) {
      const isLandBased = propertyType === 'land' || propertyType === 'house';
      return {
        matched: name,
        unitPrice: isLandBased ? coef.land : coef.mansion,
        landUnit: coef.land,
        mansionUnit: coef.mansion,
        specificity: name.length
      };
    }
  }
  return null;
}

// 対応エリア判定（細分化対応エリア）
const SUPPORTED_AREA_PATTERNS = [
  /東京都/,
  /神奈川県横浜市/,
  /神奈川県川崎市/,
  /兵庫県西宮市/,
  /兵庫県宝塚市/
];

function isSupportedArea(address) {
  return SUPPORTED_AREA_PATTERNS.some(p => p.test(address));
}

// ============================================================
// 都道府県・市区町村コード
// ============================================================
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
  '名古屋市中区':'23106','名古屋市千種区':'23101','名古屋市東区':'23102',
  '福岡市博多区':'40132','福岡市中央区':'40133'
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

// ============================================================
// 物件タイプキーワード
// ============================================================
const TYPE_KEYWORDS = {
  'mansion':       ['中古マンション等','マンション'],
  'mansion-whole': ['中古マンション等','マンション'],
  'house':         ['中古一戸建て等','一戸建て','宅地(土地と建物)'],
  'land':          ['宅地(土地)']
};

// ============================================================
// HTTP / 統計関数
// ============================================================
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

function normalizeTransaction(raw) {
  const price = parseInt(raw.TradePrice) || 0;
  const area  = parseFloat(raw.Area) || 0;
  let unitRaw = parseInt(raw.UnitPrice) || 0;
  if (unitRaw === 0 && price > 0 && area > 0) unitRaw = Math.round(price / area);
  return {
    priceMan: Math.round(price/10000),
    unitPriceMan: Math.round(unitRaw/10000*10)/10,
    area, floorPlan: raw.FloorPlan||'', buildingYear: raw.BuildingYear||'',
    structure: raw.Structure||'', period: raw.Period||'',
    district: raw.DistrictName||'', renovation: raw.Renovation||'', type: raw.Type||''
  };
}

function removeOutliers(values) {
  if (values.length < 6) return values;
  const sorted = [...values].sort((a,b) => a-b);
  const q1 = sorted[Math.floor(sorted.length*0.25)];
  const q3 = sorted[Math.floor(sorted.length*0.75)];
  const iqr = q3 - q1;
  return values.filter(v => v >= q1 - 1.5*iqr && v <= q3 + 1.5*iqr);
}

function calcStats(transactions) {
  const sorted = [...transactions].sort((a,b) => {
    if (b.period !== a.period) return b.period.localeCompare(a.period);
    return a.unitPriceMan - b.unitPriceMan;
  });
  const rawUnits = sorted.map(t => t.unitPriceMan).filter(u => u > 0);
  const units = removeOutliers(rawUnits).sort((a,b) => a-b);
  if (!units.length) return null;
  return {
    median: units[Math.floor(units.length/2)],
    mean: Math.round(units.reduce((a,b)=>a+b,0)/units.length*10)/10,
    min: units[0], max: units[units.length-1],
    count: units.length, rawCount: rawUnits.length,
    outliersRemoved: rawUnits.length - units.length
  };
}

// ============================================================
// 補正係数
// ============================================================
function calcAdjustments({ age, floor, direction, stationMin, reform, condition, propertyType }) {
  const ageFactor = propertyType !== 'land' ? Math.max(0.45, 1 - (age||0)*0.012) : 1.0;
  const floorMap = {'1':0.92,'2':0.97,'3':1.02,'4':1.08};
  const floorFactor = propertyType === 'mansion' ? (floorMap[floor]||1.0) : 1.0;
  const dirMap = {'S':1.05,'SE':1.03,'SW':1.02,'E':0.99,'W':0.97,'N':0.93};
  const dirFactor = propertyType === 'mansion' ? (dirMap[direction]||1.0) : 1.0;
  const stationFactor = propertyType !== 'land'
    ? Math.max(0.80, 1 - ((stationMin||10)-5)*0.012) : 1.0;
  const reformMap = {'none':1.0,'partial':1.03,'full':1.07};
  const reformFactor = reformMap[reform] || 1.0;
  const condMap = {'good':1.02,'normal':1.0,'poor':0.93};
  const condFactor = condMap[condition] || 1.0;
  const total = ageFactor * floorFactor * dirFactor * stationFactor * reformFactor * condFactor;
  return { ageFactor, floorFactor, dirFactor, stationFactor, reformFactor, condFactor, total };
}

// ============================================================
// API取引データ取得
// ============================================================
async function fetchTransactions(prefCode, cityCode, area, propertyType, apiKey) {
  const now = new Date();
  const keywords = TYPE_KEYWORDS[propertyType] || TYPE_KEYWORDS['mansion'];
  let all = [];

  for (let q = 0; q < 8 && all.length < 40; q++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - q*3);
    const year = d.getFullYear();
    const quarter = Math.ceil((d.getMonth()+1)/3);

    for (const priceClass of ['02','01']) {
      const params = new URLSearchParams({ year, quarter, priceClassification: priceClass });
      if (cityCode) params.set('city', cityCode);
      else params.set('prefecture', prefCode);

      try {
        const res = await httpsGet(`${BASE_URL}/XIT001?${params}`, { 'X-API-KEY': apiKey });
        if (res.body?.data?.length) {
          const filtered = res.body.data.filter(d =>
            keywords.some(kw => (d.Type||'').includes(kw))
          );
          all.push(...filtered.map(normalizeTransaction));
        }
      } catch(e) {
        console.error(`fetch q=${q}:`, e.message);
      }
    }
  }

  const filtered = all.filter(t =>
    t.unitPriceMan > 0 && t.area >= area*0.70 && t.area <= area*1.30
  );
  if (filtered.length >= 3) return filtered;
  return all.filter(t => t.unitPriceMan > 0 && t.area >= area*0.50 && t.area <= area*1.50);
}

// ============================================================
// 信頼度加重平均ロジック（推奨B案）
// ============================================================
function combineCoefAndApi(coefData, stats, propertyType) {
  // 町丁目係数の重みを計算（地名の具体性で変動）
  // 「港区赤坂」のような町名マッチ → 重み0.7（高信頼）
  // 「横浜市青葉区」のような区マッチ → 重み0.5
  // 「横浜市」のような市マッチ → 重み0.3（低信頼）
  let coefWeight = 0;
  if (coefData) {
    const len = coefData.matched.length;
    if (len >= 8) coefWeight = 0.70;       // 区名+町名（港区赤坂など）
    else if (len >= 5) coefWeight = 0.55;  // 区名のみ
    else coefWeight = 0.35;                // 市名のみ
  }

  // APIデータの重みを計算（取引件数で変動）
  let apiWeight = 0;
  if (stats && stats.count > 0) {
    if (stats.count >= 15) apiWeight = 0.65;
    else if (stats.count >= 8) apiWeight = 0.50;
    else if (stats.count >= 3) apiWeight = 0.35;
    else apiWeight = 0.20;
  }

  // どちらか片方しかない場合
  if (!coefData && !stats) return { unitPrice: 0, source: 'none' };
  if (!coefData) return { unitPrice: stats.median, source: 'api', coefWeight: 0, apiWeight: 1.0 };
  if (!stats)    return { unitPrice: coefData.unitPrice, source: 'coef', coefWeight: 1.0, apiWeight: 0 };

  // 重みを正規化
  const total = coefWeight + apiWeight;
  const cw = coefWeight / total;
  const aw = apiWeight / total;

  const blended = coefData.unitPrice * cw + stats.median * aw;
  return {
    unitPrice: Math.round(blended * 10) / 10,
    source: 'blended',
    coefWeight: Math.round(cw * 100) / 100,
    apiWeight: Math.round(aw * 100) / 100,
    coefValue: coefData.unitPrice,
    apiValue: stats.median
  };
}

// ============================================================
// メインハンドラ
// ============================================================
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers, body:'' };
  if (event.httpMethod !== 'POST') return { statusCode:405, headers, body:JSON.stringify({error:'Method not allowed'}) };

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      address, propertyType,
      area, landArea, floorArea,
      age, floor, direction, stationMin, reform, condition
    } = body;

    if (!address) return { statusCode:400, headers, body:JSON.stringify({error:'住所は必須です'}) };

    const apiKey = process.env.REINFOLIB_API_KEY || '';
    const prefCode = extractPrefCode(address);
    const cityCode = extractCityCode(address);
    const adjustments = calcAdjustments({ age, floor, direction, stationMin, reform, condition, propertyType });

    // 計算で使う面積を決定
    const useLandArea = (propertyType === 'house' || propertyType === 'mansion-whole' || propertyType === 'land');
    const calcArea = useLandArea ? (landArea || 0) : (area || 0);

    if (calcArea < 10) {
      return { statusCode:400, headers, body:JSON.stringify({error:'面積を入力してください'}) };
    }

    console.log(`addr=${address} pref=${prefCode} city=${cityCode} type=${propertyType} area=${calcArea} adj=${adjustments.total.toFixed(3)}`);

    // 町丁目係数を取得
    const coefData = lookupCoefficient(address, propertyType);
    console.log(`coef matched=${coefData?.matched} unit=${coefData?.unitPrice}`);

    // API取引データを取得（apiKeyがあれば）
    let transactions = [], stats = null;
    if (apiKey) {
      transactions = await fetchTransactions(prefCode, cityCode, calcArea, propertyType, apiKey);
      stats = calcStats(transactions);
      console.log(`api: txs=${transactions.length} stats=${stats?.median}`);
    }

    // ─── 戸建て: 原価法（土地+建物） ───
    if (propertyType === 'house') {
      // 土地値（係数+API信頼度加重）
      const landBlend = combineCoefAndApi(coefData, stats, 'land');
      if (landBlend.unitPrice === 0) {
        return { statusCode:500, headers, body:JSON.stringify({error:'対象エリアのデータが不足しています'}) };
      }

      // 延床面積（未入力時は土地面積×60%で推定）
      const floorAreaUsed = floorArea && floorArea > 0 ? floorArea : Math.round(calcArea * 0.6);
      const floorAreaEstimated = !floorArea || floorArea === 0;

      // 建物原価（木造想定）
      const RECONSTRUCT_UNIT = 16.85; // 万円/㎡
      const LEGAL_LIFE = 22; // 木造耐用年数
      const ageVal = age || 0;
      const remainRatio = Math.max(0.1, (LEGAL_LIFE - ageVal) / LEGAL_LIFE);
      const buildingValue = Math.round(floorAreaUsed * RECONSTRUCT_UNIT * remainRatio);
      const landValue = Math.round(landBlend.unitPrice * calcArea);

      // 補正係数を全体に適用（リフォーム・管理状態のみ）
      const houseAdjFactor = adjustments.reformFactor * adjustments.condFactor;
      const subtotal = landValue + buildingValue;
      const finalPrice = Math.round(subtotal * houseAdjFactor);
      const finalUnitPrice = Math.round(finalPrice / calcArea * 10) / 10;

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          isMock: false, address, propertyType, prefCode, cityCode,
          isSupported: isSupportedArea(address),
          estimatedPrice: finalPrice,
          estimatedUnitPrice: finalUnitPrice,
          calcArea,
          breakdown: {
            landUnit: landBlend.unitPrice, landArea: calcArea, landValue,
            buildingUnit: RECONSTRUCT_UNIT, floorArea: floorAreaUsed,
            floorAreaEstimated, remainRatio: Math.round(remainRatio*100),
            buildingValue, subtotal,
            adjFactor: Math.round(houseAdjFactor*1000)/1000
          },
          coefMatched: coefData?.matched || null,
          dataSource: landBlend.source,
          weights: { coef: landBlend.coefWeight, api: landBlend.apiWeight },
          coefValue: landBlend.coefValue, apiValue: landBlend.apiValue,
          transactions: transactions.slice(0,10), stats, adjustments
        })
      };
    }

    // ─── マンション・土地・一棟: 取引比較法（係数+API加重） ───
    const blend = combineCoefAndApi(coefData, stats, propertyType);
    if (blend.unitPrice === 0) {
      return { statusCode:500, headers, body:JSON.stringify({error:'対象エリアのデータが不足しています'}) };
    }

    const adjUnitPrice = Math.round(blend.unitPrice * adjustments.total * 10) / 10;
    const estimatedPrice = Math.round(adjUnitPrice * calcArea);

    // 戸建ての参考内訳（土地のみ）
    let breakdown = null;
    if (propertyType === 'land') {
      breakdown = {
        landUnit: blend.unitPrice, landArea: calcArea,
        landValue: estimatedPrice,
        buildingUnit: 0, floorArea: 0, floorAreaEstimated: false,
        remainRatio: 0, buildingValue: 0,
        subtotal: estimatedPrice, adjFactor: adjustments.total
      };
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        isMock: false, address, propertyType, prefCode, cityCode,
        isSupported: isSupportedArea(address),
        estimatedPrice, estimatedUnitPrice: adjUnitPrice, calcArea,
        breakdown,
        coefMatched: coefData?.matched || null,
        dataSource: blend.source,
        weights: { coef: blend.coefWeight, api: blend.apiWeight },
        coefValue: blend.coefValue, apiValue: blend.apiValue,
        transactions: transactions.slice(0,10), stats, adjustments
      })
    };

  } catch(e) {
    console.error('Function error:', e);
    return { statusCode:500, headers, body:JSON.stringify({ error: e.message }) };
  }
};
