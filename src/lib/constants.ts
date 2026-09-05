
export const THEME_OPTIONS: readonly string[] = ["light", "dark", "system"];

export const DATING_GOALS: readonly string[] = [
    "goal.serious_relationship",
    "goal.one_night",
    "goal.friendship",
    "goal.family_kids",
    "goal.travel",
    "goal.co_living",
    "goal.just_talk",
    "goal.penpal",
    "goal.dating",
    "goal.new_friends",
    "goal.no_commitment"
];

export const INTEREST_OPTIONS: readonly string[] = [
    "interest.sport",
    "interest.music",
    "interest.movies",
    "interest.books",
    "interest.travel",
    "interest.cooking",
    "interest.games",
    "interest.art",
    "interest.photography",
    "interest.tech",
    "interest.fashion",
    "interest.dance",
    "interest.animals",
    "interest.volunteering",
    "interest.politics",
    "interest.psychology",
    "interest.philosophy",
    "interest.yoga",
    "interest.meditation",
    "interest.gardening",
    "interest.cars",
    "interest.science",
    "interest.history",
    "interest.architecture",
    "interest.coffee",
    "interest.nature",
    "interest.design",
    "interest.pets",
    "interest.astronomy",
    "interest.board_games",
    "interest.dancing",
    "interest.diy",
    "interest.extreme",
    "interest.films",
    "interest.food",
    "interest.gaming",
    "interest.hiking",
    "interest.martial_arts",
    "interest.podcasts",
    "interest.reading",
];

export const ZODIAC_SIGNS: readonly string[] = [
    "common.zodiac.aries",
    "common.zodiac.taurus",
    "common.zodiac.gemini",
    "common.zodiac.cancer",
    "common.zodiac.leo",
    "common.zodiac.virgo",
    "common.zodiac.libra",
    "common.zodiac.scorpio",
    "common.zodiac.sagittarius",
    "common.zodiac.capricorn",
    "common.zodiac.aquarius",
    "common.zodiac.pisces"
];

export const EDUCATION_OPTIONS: readonly string[] = [
    "education.secondary",
    "education.vocational",
    "education.incomplete_higher",
    "education.higher",
    "education.bachelor",
    "education.master",
    "education.candidate",
    "education.doctor"
];

export const CAPITALS: readonly string[] = [
    "Москва", 
    "Санкт-Петербург",
    "Новосибирск",
    "Екатеринбург",
    "Казань",
    "Нижний Новгород",
    "Челябинск",
    "Самара",
    "Омск",
    "Ростов-на-Дону",
    "Уфа",
    "Красноярск",
    "Воронеж",
    "Пермь",
    "Волгоград"
];

export const POPULAR_CITIES: Record<string, string[]> = {
  "Китай": ["Acheng", "Ahu", "Aihui", "Ālā'ĕr", "Anbu", "Anda", "Anguo", "Anjiang", "Ankang", "Anliu", "Anlong", "Anlu", "Anning", "Anqing", "Anqiu", "Anshan", "Anshun", "Antu", "Ānwén", "Anyang"],
  "Индия": ["Abohar", "Ābu Road", "Achalpur", "Ādilābād", "Adoni", "Agartala", "Agra", "Ahilyanagar", "Ahmedabad", "Airoli", "Aizawl", "Ajmer", "Akola", "Akot", "Alandur", "Alappuzha", "Alīgarh", "Alīpur Duār", "Allinagaram", "Alwar"],
  "США": ["Abilene", "Abington", "Ahwatukee Foothills", "Akron", "Alafaya", "Alameda", "Albany", "Albany Park", "Albuquerque", "Alexandria", "Alhambra", "Alief", "Aliso Viejo", "Allapattah", "Allen", "Allentown", "Alpharetta", "Amarillo", "Ames", "Amherst"],
    "Беларусь": ["Minsk", "Homyel'", "Hrodna", "Vitebsk", "Mahilyow", "Brest", "Bobruysk", "Baranovichi", "Barysaw", "Pinsk", "Mazyr", "Lida", "Orsha", "Soligorsk", "Novopolotsk", "Maladziečna", "Polotsk", "Zhlobin", "Rechytsa", "Horad Zhodzina", "Svetlogorsk", "Slutsk", "Kobryn"],
"Бразилия": ["Abaetetuba", "Abreu e Lima", "Açailândia", "Acará", "Acaraú", "Açu", "Agua Rasa", "Água Rasa", "Águas Claras", "Águas Lindas de Goiás", "Alagoinhas", "Alegrete", "Alenquer", "Alfenas", "Almirante Tamandaré", "Altamira", "Alvorada", "Americana", "Amparo", "Ananindeua"],
  "Япония": ["Abiko", "Adachi", "Ageo", "Aihara", "Aira", "Aisai", "Aizu-Wakamatsu", "Akashi", "Akihabara", "Akiruno", "Akishima", "Akita", "Ama", "Amagasaki", "Amakusa", "Anan", "Anjō", "Annaka", "Aomori", "Arakawa"],
  "Россия": ["Abakan", "Achinsk", "Adler", "Admiralteisky", "Akademgorodok", "Akademicheskoe", "Al’met’yevsk", "Aleksandrov", "Alekseyevka", "Aleksin", "Altuf’yevskiy", "Anapa", "Angarsk", "Anzhero-Sudzhensk", "Apatity", "Arkhangel’sk", "Armavir", "Arsen’yev", "Artëm", "Arzamas"],
  "Филиппины": ["Alabel", "Alicia", "Angat", "Angeles City", "Angono", "Antipolo", "Apalit", "Aparri", "Arayat", "Bacolod City", "Bacoor", "Bago City", "Bagong Barrio", "Bagong Silang", "Bagong Silangan", "Baguio", "Bais", "Balagtas", "Balanga", "Balayan"],
  "Индонезия": ["Abepura", "Adiwerna", "Ambarawa", "Ambon", "Amuntai", "Arjawinangun", "Astanajapura", "Atambua", "Baekrajan", "Baki", "Balai Pungut", "Balikpapan", "Banda Aceh", "Bandar Lampung", "Bandung", "Bangil", "Bangkalan", "Banjar", "Banjaran", "Banjarbaru"],
  "Великобритания": ["Aberdeen", "Acton", "Archway", "Ashford", "Aylesbury", "Bangor", "Barking", "Barnsley", "Barrow in Furness", "Barry", "Basildon", "Basingstoke", "Bath", "Battersea", "Bebington", "Beckenham", "Becontree", "Bedford", "Belfast", "Bexley"],
  "Германия": ["Aachen", "Aalen", "Ahlen", "Alt-Hohenschönhausen", "Altona", "Arnsberg", "Aschaffenburg", "Augsburg", "Bad Homburg vor der Höhe", "Bad Salzuflen", "Baden-Baden", "Bamberg", "Bayreuth", "Bergedorf", "Bergheim", "Bergisch Gladbach", "Bergkamen", "Berlin", "Berlin Köpenick", "Bielefeld"],
  "Мексика": ["Acámbaro", "Acapulco de Juárez", "Acayucan", "Agua Prieta", "Aguascalientes", "Altamira", "Álvaro Obregón", "Amozoc de Mota", "Apatzingán", "Arandas", "Atlixco", "Azcapotzalco", "Benito Juarez", "Benito Juárez", "Buenavista", "Cabo San Lucas", "Cadereyta", "Cadereyta Jiménez", "Campeche", "Cancún"],
  "Вьетнам": ["An Hải", "An Khê", "An Nhơn", "Ba Dinh", "Ba Đồn", "Ba Vì", "Bắc Giang", "Bạc Liêu", "Bắc Ninh", "Bắc Quang", "Bắc Từ Liêm", "Bạch Mai", "Bảo Lộc", "Bến Cát", "Bến Tre", "Biên Hòa", "Bỉm Sơn", "Bình Minh", "Bình Thạnh", "Bình Thủy"],
  "Испания": ["A Coruña", "Albacete", "Alcalá de Guadaira", "Alcalá de Henares", "Alcobendas", "Alcorcón", "Alcoy", "Algeciras", "Algorta", "Alicante", "Almería", "Aluche", "Aranjuez", "Arganda", "Arganzuela", "Arona", "Arrecife", "Ávila", "Avilés", "Badajoz"],
  "Турция": ["Adana", "Adapazarı", "Adilcevaz", "Adıyaman", "Afyonkarahisar", "Ağrı", "Ahlat", "Akçapınar", "Akhisar", "Aksaray", "Akşehir", "Alanya", "Amasya", "Anamur", "Ankara", "Antakya", "Antalya", "Ardeşen", "Arnavutköy", "Arsuz"],
  "Иран": ["Abadan", "Abadeh", "Ābādeh", "Abhar", "Ābyek", "Ahar", "Ahvaz", "Alīgūdarz", "Alvand", "Āmol", "Andīmeshk", "Andīsheh", "Arāk", "Ārān Bīdgol", "Ardabīl", "Ardakān", "Asadābād", "Āzādshahr", "Bābol", "Bāghestān"],
  "Нигерия": ["Aba", "Abakaliki", "Abeokuta", "Abuja", "Ado-Ekiti", "Afikpo", "Agbor", "Agulu", "Ajegunle", "Akowonjo", "Aku", "Akure", "Aliayabiagba", "Alimosho", "Amaigbo", "Apomu", "Aramoko-Ekiti", "Asaba", "Atani", "Auchi"],
  "Пакистан": ["Abbottabad", "Ahmadpur East", "Alahabad", "Arif Wala", "Arifwala", "Attock City", "Badin", "Bahawalnagar", "Bahawalpur", "Bannu", "Battagram", "Bhakkar", "Bhalwal", "Buni", "Burewala", "Chakwal", "Chaman", "Charsadda", "Chichawatni", "Chiniot"],
  "Украина": ["Alchevsk", "Antratsyt", "Avtozavodskyi", "Bakhmut", "Berdyansk", "Berdychiv", "Berestovskyi", "Bila Tserkva", "Bohodukhivskyi", "Bohuniya", "Borshchahivka", "Boryspil", "Bosse", "Brovary", "Cheremushky", "Cherkasy", "Chernihiv", "Chernivtsi", "Chokolivka", "Chornomors’k"],
  "Канада": ["Abbotsford", "Ahuntsic-Cartierville", "Airdrie", "Ajax", "Aurora", "Aylmer", "Barrie", "Beauport", "Belleville", "Brampton", "Brantford", "Brighouse-City Centre", "Brossard", "Burlington", "Burnaby", "Caledon", "Calgary", "Cambridge", "Charlesbourg", "Chicoutimi"],
  "Франция": ["Aix-en-Provence", "Ajaccio", "Albi", "Amiens", "Angers", "Antibes", "Antony", "Argenteuil", "Arles", "Asnières-sur-Seine", "Aubervilliers", "Aulnay-sous-Bois", "Avignon", "Beauvais", "Belfort", "Besançon", "Béziers", "Blois", "Bordeaux", "Boulogne-Billancourt"],
  "Египет": ["‘Izbat ‘Alī as Sayyid", "6th of October City", "Abnūb", "Abū al Maţāmīr", "Abū an Numrus", "Abū Ḩummuş", "Abū Kabīr", "Abū Qurqāş", "Abū Tīj", "Ad Dilinjāt", "Akhmīm", "Al ‘Āshir min Ramaḑān", "Al Badārī", "Al Badrashayn", "Al Bājūr", "Al Balyanā", "Al Burj", "Al Fashn", "Al Fayyum", "Al Ghanāyim"],
  "Малайзия": ["Alor Setar", "Ampang", "Ara Damansara", "Bandar Bukit Raja", "Bandar Kinrara", "Bandar Labuan", "Bandar Mahkota Cheras", "Bandar Saujana Utama", "Bandar Seri Alam", "Bandar Sunway", "Bandar Tasik Puteri", "Bandar Utama", "Batu Caves", "Batu Pahat", "Bau", "Bayan Lepas", "Bercham", "Bintulu", "Bukit Bintang", "Bukit Indah"],
  "Италия": ["Acerra", "Acilia-Castel Fusano-Ostia Antica", "Afragola", "Alessandria", "Altamura", "Ancona", "Andria", "Aprilia", "Arenella", "Arezzo", "Asti", "Aversa", "Bagheria", "Bari", "Barletta", "Barriera di Lanzo", "Barriera di Milano", "Benevento", "Bergamo", "Bisceglie"],
  "ЮАР": ["Alberton", "Alexandra", "Athlone", "Atlantis", "Barberton", "Bela Bela", "Benoni", "Bethal", "Bethlehem", "Bhisho", "Bloemfontein", "Boksburg", "Bothaville", "Botshabelo", "Brakpan", "Brits", "Butterworth", "Cape Town", "Carletonville", "Centurion"],
  "Таиланд": ["Anusawari", "Ban I Chang", "Ban Khlong Prawet", "Ban Ko Sire", "Ban Lak Song", "Ban Lam Luk Ka", "Ban Mai", "Ban Pong", "Ban Samae Dam", "Ban Talat Yai", "Ban Tha Kham", "Bang Bon", "Bang Kapi", "Bang Khae", "Bang Khae Nuea", "Bang Khun Thian", "Bang Kruai", "Bang Na", "Bang Phlat", "Bang Rak"],
  "Венесуэла": ["Acarigua", "Altagracia de Orituco", "Alto Barinas", "Anaco", "Araure", "Barcelona", "Barinas", "Barinitas", "Barquisimeto", "Baruta", "Biruaca", "Boconó", "Cabimas", "Cabudare", "Cagua", "Caicara del Orinoco", "Calabozo", "Cantaura", "Caracas", "Carora"],
  "Польша": ["Będzin", "Bełchatów", "Bemowo", "Biała Podlaska", "Białołeka", "Białystok", "Bielany", "Bielsko-Biala", "Bydgoszcz", "Bytom", "Chełm", "Chorzów", "Częstochowa", "Dąbrowa Górnicza", "Elbląg", "Ełk", "Fordon", "Gdańsk", "Gdynia", "Gliwice"],
  "Колумбия": ["Aguachica", "Agustín Codazzi", "Apartadó", "Arauca", "Arjona", "Armenia", "Ayapel", "Baranoa", "Barbosa", "Barrancabermeja", "Barranquilla", "Bello", "Bogotá", "Bucaramanga", "Buenaventura", "Cajicá", "Calarcá", "Caldas", "Cali", "Cartagena"],
  "Алжир": ["Adrar", "Aflou", "Aïn Beïda", "Aïn Defla", "Aïn M’Lila", "Aïn Oulmene", "Aïn Oussera", "Aïn Temouchent", "Aïn Touta", "Algiers", "Ali Mendjeli", "Annaba", "Arzew", "Assi Bou Nif", "Bab Ezzouar", "Baraki", "Barika", "Batna", "Béchar", "Béjaïa"],
  "Южная Корея": ["Andong", "Ansan-si", "Anseong", "Anyang-si", "Asan", "Boryeong", "Bucheon-si", "Busan", "Buyeo", "Changnyeong", "Changwon", "Cheonan", "Cheongju-si", "Chinch'ŏn", "Chinju", "Chuncheon", "Chungju", "Daegu", "Daejeon", "Donghae City"],
  "Аргентина": ["Azul", "Bahía Blanca", "Balvanera", "Barracas", "Barranqueras", "Belgrano", "Bella Vista", "Berazategui", "Buenos Aires", "Campana", "Castelar", "Catamarca", "Chimbas", "Chivilcoy", "Cipolletti", "Colegiales", "Colón", "Comodoro Rivadavia", "Concepción del Uruguay", "Concordia"],
  "Бангладеш": ["Ashuganj City", "Azimpur", "Bagerhat", "Bāndarban", "Barishal", "Bhairab Bāzār", "Bhatara", "Bhola", "Bibir Hat", "Bogra", "Brāhmanbāria", "Chāndpur", "Chattogram", "Comilla", "Cox’s Bāzār", "Dhaka", "Dhanmondi", "Dinajpur", "Farīdpur", "Feni"],
  "ДР Конго": ["Aketi", "Babamba", "Bakwa", "Bandundu Province", "Basoko", "Baudhuinville", "Beni", "Binga", "Boende", "Bolenge", "Boma", "Bukama", "Bukavu", "Bulungu", "Bumba", "Bunia", "Buta", "Butembo", "Dibaya-Lubwe", "Fungurume"],
  "Марокко": ["Ad Darwa", "Agadir", "Ain El Aouda", "Aïn Harrouda", "Ait Melloul", "Al Aaroui", "Al Fqih Ben Çalah", "Al Hoceïma", "Azrou", "Bejaâd", "Ben Guerir", "Ben Jerrar", "Beni Enzar", "Beni Mellal", "Benslimane", "Berkane", "Berrechid", "Bouskoura", "Casablanca", "Dakhla"],
  "Мьянма": ["Amarapura", "Ann", "Bago", "Bhamo", "Bogale", "Buthidaung Town", "Chauk", "Dawbon", "Dawei", "Gwa", "Heho", "Hinthada", "Hlaingthaya", "Hpa-An", "Hpākān", "Insein", "Kalaw", "Kalemyo", "Kanbe", "Kawthoung"],
  "Эфиопия": ["‘Alemaya", "Addis Ababa", "Ādīgrat", "Adwa", "Āgaro", "Aksum", "Alamata", "Ārabī", "Arba Minch", "Āreka", "Arsi Negele", "Āsela", "Āsosa", "Awasa", "Bahir Dar", "Bishoftu", "Bodītī", "Bonga", "Burayu", "Butajīra"],
  "Ангола": ["Andulo", "Bailundo", "Barra do Dande", "Benfica", "Benguela", "Caála", "Cabinda", "Cacuaco", "Cafunfo", "Calumbo", "Camacupa", "Camama", "Camucuio", "Catumbela", "Caxito", "Cazenga", "Cela", "Chitato", "Cuango-Luzamba", "Cubal"],
  "Ирак": ["'Ākra", "Abū al-Kahṣīb", "Abū Ghurayb", "Al ‘Amārah", "Al Başrah al Qadīmah", "Al Diwaniyah", "Al Fallūjah", "Al Fāw", "Al Hārithah", "Al Ḩayy", "Al Hillah", "Al Hindīyah", "Al Madīnah", "Al Maḩmūdīyah", "Al Mawşil al Jadīdah", "Al Miqdādīyah", "Al Qā’im", "Al Qurnah", "Al-Hamdaniya", "Al-Kut"],
  "Нидерланды": ["'s-Hertogenbosch", "Alkmaar", "Almelo", "Almere Stad", "Alphen aan den Rijn", "Amersfoort", "Amstelveen", "Amsterdam", "Amsterdam-Zuidoost", "Apeldoorn", "Arnhem", "Assen", "Bergen op Zoom", "Breda", "Capelle aan den IJssel", "Delft", "Den Helder", "Deventer", "Dordrecht", "Ede"],
  "Перу": ["Abancay", "Arequipa", "Ayacucho", "Belen", "Breña", "Cajamarca", "Callao", "Catacaos", "Cerro de Pasco", "Chiclayo", "Chilca", "Chimbote", "Chincha Alta", "Chosica", "Chulucanas", "Ciudad Satelite", "Cusco", "Huacho", "Huancayo", "Huánuco"]
};

export const CIRCADIAN_RHYTHM_OPTIONS = [
    { value: 'early-bird', label: 'circadian.early_bird' },
    { value: 'night-owl', label: 'circadian.night_owl' },
    { value: 'flexible', label: 'circadian.flexible' },
];

export const ATTACHMENT_STYLE_OPTIONS = [
    { value: 'secure', label: 'attachment.secure' },
    { value: 'anxious', label: 'attachment.anxious' },
    { value: 'avoidant', label: 'attachment.avoidant' },
];

export interface TitleMetadata {
  id: string;
  name_en: string;
  name_ru: string;
  icon: string;
  description_en: string;
  description_ru: string;
  color?: string;
}

export const ALL_TITLES: TitleMetadata[] = [
    {
        id: 'rookie',
        name_en: 'Rookie',
        name_ru: 'Новичок',
        icon: '👶',
        description_en: 'Just starting their journey on SwiftMatch.',
        description_ru: 'Только начинает свой путь на SwiftMatch.',
    },
    {
        id: 'romantic',
        name_en: 'Romantic',
        name_ru: 'Романтик',
        icon: '📜',
        description_en: 'Has a thoughtfully filled out bio.',
        description_ru: 'Имеет вдумчиво заполненную биографию.',
    },
    {
        id: 'party',
        name_en: 'Party Animal',
        name_ru: 'Душа компании',
        icon: '🎉',
        description_en: 'Has a wide variety of interests.',
        description_ru: 'Имеет широкий спектр интересов.',
    },
    {
        id: 'king',
        name_en: 'King of Hearts',
        name_ru: 'Король сердец',
        icon: '👑',
        description_en: 'Mastered the art of matching with over 90% compatibility.',
        description_ru: 'Освоил искусство мэтчинга с совместимостью более 90%.',
    },
];

export const BANNED_WORDS: readonly string[] = ["Хуй"];
