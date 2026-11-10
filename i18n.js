// Hindi + English texts. t('key', {param}) -> string. Falls back to English, then to the key itself.
// Religious wording is kept simple on purpose: the app never invents rulings, only scholars answer.
const KEY = 'askdeen.lang';
const safe = fn => { try { return fn(); } catch { return null; } };

const hi = {
  tagline: 'सवाल पूछो, इल्म पाओ',
  skip: 'मुख्य सामग्री पर जाएँ',
  back: 'वापस', retry: 'दोबारा कोशिश करें', cancel: 'रद्द करें', delete: 'हटाएँ', edit: 'बदलें', filter: 'फ़िल्टर',
  email: 'ईमेल', password: 'पासवर्ड', login: 'लॉगिन', signup: 'साइन अप', logout: 'लॉगआउट', search: 'खोजें',
  loadmore: 'और दिखाएँ', viewall: 'सब देखें', like: 'पसंद', save: 'सेव', share: 'शेयर', report: 'रिपोर्ट', helpful: 'मददगार',
  follow: 'फ़ॉलो', followers: 'फ़ॉलोअर', answers: 'जवाब', scholar: 'आलिम', verified: 'सत्यापित आलिम', notfound: 'यह पेज नहीं मिला।',
  'lang.title': 'भाषा / Language', 'lang.cur': 'हिन्दी', 'lang.switch': 'भाषा बदलें',

  'nav.home': 'होम', 'nav.qa': 'सवाल-जवाब', 'nav.ask': 'पूछें', 'nav.scholars': 'आलिम', 'nav.profile': 'प्रोफ़ाइल', 'nav.notifications': 'सूचनाएँ',

  'meta.home': 'Alfrzo Ilm: अपने दीनी सवाल पूछिए और सत्यापित आलिम/मुफ़्ती से जवाब पाइए। आपकी पहचान गुप्त रहती है।',
  'meta.feed': 'दीनी सवालों के जवाब: नमाज़, रोज़ा, ज़कात, निकाह, हलाल-हराम और बहुत कुछ। सत्यापित आलिमों द्वारा।',
  'meta.ask': 'अपना दीनी सवाल गुमनाम तरीके से पूछिए। जवाब आलिम देंगे।',
  'meta.scholars': 'Alfrzo Ilm के सत्यापित आलिम और मुफ़्ती, उनकी योग्यता और जवाब।',

  'home.h1a': 'अपने दीनी सवाल पूछिए,', 'home.h1b': 'आलिम से जवाब पाइए।',
  'home.sub': 'आपकी पहचान गुप्त। जवाब सत्यापित आलिमों से।',
  'home.search': 'अपना सवाल यहाँ लिखें…', 'home.ask': 'सवाल पूछें', 'home.cats': 'श्रेणियाँ', 'home.latest': 'ताज़ा सवाल-जवाब',
  'home.popular': 'लोकप्रिय विषय', 'home.scholars': 'ख़ास सत्यापित आलिम', 'home.trust': 'निजता और भरोसा',
  'home.noq': 'अभी कोई सवाल नहीं है। पहला सवाल आप पूछिए!', 'home.nopop': 'अभी कोई लोकप्रिय सवाल नहीं है।',
  'trust.anon.t': 'गुमनाम सवाल', 'trust.anon.d': 'आपका नाम किसी को नहीं दिखता, न आलिम को, न दूसरे लोगों को।',
  'trust.phone.t': 'फ़ोन नंबर कभी सार्वजनिक नहीं', 'trust.phone.d': 'हम आपसे फ़ोन नंबर नहीं माँगते और सवालों में नंबर लिखने नहीं देते।',
  'trust.verified.t': 'सत्यापित आलिम', 'trust.verified.d': 'हर आलिम की योग्यता एडमिन जाँचता है, तभी जवाब देने की इजाज़त मिलती है।',
  'trust.refs.t': 'भरोसेमंद हवाले', 'trust.refs.d': 'क़ुरआन और हदीस के हवाले आलिम ख़ुद जाँचकर लिखते हैं।',

  'cat.all': 'सभी', 'cat.more': 'और', 'cat.title': 'श्रेणियाँ',
  'tab.latest': 'ताज़ा', 'tab.popular': 'लोकप्रिय', 'tab.following': 'फ़ॉलोइंग',
  'st.all': 'सभी', 'st.answered': 'जवाब मिला', 'st.open': 'जवाब का इंतज़ार', 'st.pending': 'जाँच में', 'st.rejected': 'अस्वीकृत',
  'feed.search': 'सवाल खोजें…', 'feed.empty': 'इस फ़िल्टर में कोई सवाल नहीं मिला।', 'feed.nofollow': 'आपने अभी किसी आलिम को फ़ॉलो नहीं किया है। आलिमों को फ़ॉलो करें, उनके जवाब यहाँ दिखेंगे।',

  'ask.title': 'सवाल पूछें', 'ask.q': 'आपका सवाल', 'ask.ph': 'अपना सवाल यहाँ लिखें… (हिन्दी / English / اردو)',
  'ask.detail': 'ज़्यादा जानकारी (ज़रूरी नहीं)', 'ask.detail.ph': 'सवाल को समझाने के लिए ज़रूरी बातें लिखें। फ़ोन नंबर या पता न लिखें।',
  'ask.cat': 'श्रेणी', 'ask.pickcat': 'श्रेणी चुनें', 'ask.lang': 'सवाल की भाषा', 'ask.img': 'तस्वीर (ज़रूरी नहीं)',
  'ask.img.type': 'सिर्फ़ JPG, PNG या WebP तस्वीर चुनें।', 'ask.img.size': 'तस्वीर 2 MB से छोटी होनी चाहिए।',
  'ask.img.warn': 'तस्वीर निजी रहती है: सिर्फ़ आप, सत्यापित आलिम और एडमिन देख सकते हैं। नाम या चेहरा हो तो न लगाएँ।',
  'ask.anon': 'गुमनाम रहें', 'ask.anon.d': 'आपका नाम सवाल के साथ नहीं दिखेगा।', 'ask.anon.short': 'गुमनाम',
  'ask.privacy': 'आपका फ़ोन नंबर और ईमेल कभी सार्वजनिक नहीं होते। सवाल पहले जाँचा जाता है, फिर सबको दिखता है।',
  'ask.submit': 'सवाल भेजें', 'ask.sending': 'भेजा जा रहा है…', 'ask.err.short': 'सवाल कम से कम 10 अक्षर का लिखें।', 'ask.err.cat': 'कृपया श्रेणी चुनें।',
  'ask.done.t': 'सवाल मिल गया', 'ask.done.d': 'आपका सवाल जाँच में है। मंज़ूर होते ही वह सबको दिखेगा और जवाब आने पर आपको सूचना मिलेगी।', 'ask.another': 'एक और सवाल पूछें',

  'my.q': 'मेरे सवाल', 'my.empty': 'आपने अभी कोई सवाल नहीं पूछा।',
  'my.status.pending_review': 'आपका सवाल जाँच में है। मंज़ूर होने पर सबको दिखेगा।', 'my.status.open': 'सवाल सबको दिख रहा है, आलिम के जवाब का इंतज़ार है।',
  'my.status.answered': 'इस सवाल का जवाब आ गया है।', 'my.status.rejected': 'यह सवाल हमारे नियमों के अनुसार मंज़ूर नहीं हुआ।',
  'my.delete': 'सवाल हटाएँ', 'my.delete.d': 'यह सवाल और उसके जवाब हमेशा के लिए हट जाएँगे। क्या आप पक्का हटाना चाहते हैं?', 'my.deleted': 'सवाल हटा दिया गया।',

  'qd.title': 'सवाल और जवाब', 'qd.answers': 'आलिम के जवाब', 'qd.unanswered': 'इस सवाल का जवाब अभी नहीं आया है।', 'qd.notpublic': 'यह सवाल अभी सबको नहीं दिख रहा।',
  'qd.notfound': 'यह सवाल नहीं मिला या आप इसे नहीं देख सकते।', 'qd.img': 'सवाल के साथ लगाई गई तस्वीर', 'qd.img.private': 'इस सवाल के साथ एक निजी तस्वीर है।',
  'qd.disc': 'यह जवाब आम जानकारी के लिए है। अपनी ख़ास हालत में अपने भरोसेमंद, योग्य आलिम से ज़रूर मशविरा करें।',
  'qd.disc.strong': 'यह मसला हालात पर निर्भर करता है (निकाह, परिवार, मीरास, ज़कात, हज, अक़ीदा, हलाल-हराम)। फ़ैसले से पहले अपने इलाक़े के योग्य मुफ़्ती से रूबरू या फ़ोन पर ज़रूर पूछें।',
  'ans.quran': 'क़ुरआन', 'ans.hadith': 'हदीस', 'ans.edited': 'संपादित', 'ans.refs.note': 'ये हवाले आलिम ने ख़ुद जाँचकर लिखे हैं।',

  'sa.write': 'जवाब लिखें', 'sa.edit': 'जवाब बदलें', 'sa.answer': 'आपका जवाब', 'sa.ph': 'जवाब यहाँ लिखें। साफ़ और आसान ज़बान में, दलील के साथ।',
  'sa.quran.ph': 'जैसे: सूरह अल-बक़रह 2:183 (सिर्फ़ वही लिखें जो आपने जाँचा हो)', 'sa.hadith.ph': 'जैसे: सहीह बुख़ारी, हदीस 1 (किताब और नंबर के साथ)',
  'sa.verify': 'मैंने ऊपर लिखे सभी क़ुरआन और हदीस के हवाले मूल स्रोत से जाँच लिए हैं।', 'sa.publish': 'जवाब छापें', 'sa.update': 'जवाब सहेजें',
  'sa.published': 'जवाब छप गया।', 'sa.updated': 'जवाब बदल गया।', 'sa.err.short': 'जवाब कम से कम 10 अक्षर का लिखें।',
  'sa.err.verify': 'हवाले लिखे हैं, तो पहले जाँच की पुष्टि वाला बॉक्स चुनें।',
  'sa.rules': 'नियम: बिना जाँचे हवाला न लिखें, कोई हवाला गढ़ें नहीं, फ़ोन नंबर/लिंक/संपर्क न दें, और जिस बात का इल्म न हो उसके बारे में साफ़ लिखें।',
  'sa.notverified': 'आपका आलिम खाता अभी सत्यापित नहीं हुआ। सत्यापन के बाद आप जवाब दे सकेंगे।',

  'saved.title': 'सेव किए जवाब', 'saved.empty': 'आपने अभी कोई जवाब सेव नहीं किया।', 'saved.added': 'जवाब सेव हो गया।', 'saved.removed': 'सेव से हटा दिया।', 'saved.remove': 'हटाएँ',
  'save.noanswer': 'जवाब आने पर सेव कर सकेंगे',

  'sch.title': 'आलिम / मुफ़्ती', 'sch.search': 'आलिम खोजें…', 'sch.profile': 'आलिम की प्रोफ़ाइल', 'sch.bio': 'परिचय', 'sch.published': 'दिए गए जवाब',
  'sch.noans': 'इन्होंने अभी कोई जवाब नहीं दिया।', 'sch.nomatch': 'इस खोज से कोई आलिम नहीं मिला।', 'sch.notfound': 'आलिम की प्रोफ़ाइल नहीं मिली।',
  'sch.pending': 'सत्यापन बाक़ी', 'scholars.none': 'अभी कोई सत्यापित आलिम नहीं है।',
  'follow.on': 'फ़ॉलो किया', 'following.on': 'फ़ॉलो किया', 'following.title': 'फ़ॉलो किए आलिम', 'following.empty': 'आपने अभी किसी आलिम को फ़ॉलो नहीं किया।',

  'search.hint': 'कोई भी शब्द लिखकर खोजें, जैसे: रोज़ा, ज़कात, निकाह।', 'search.none': 'कोई सवाल नहीं मिला। आप नया सवाल पूछ सकते हैं।',
  'search.recent': 'हाल की खोज', 'search.count': '{n} नतीजे',

  'report.title': 'रिपोर्ट करें', 'report.help': 'अगर यह सामग्री ग़लत, भ्रामक या अनुचित है तो बताइए। एडमिन जाँच करेंगे।', 'report.reason': 'वजह', 'report.more': 'और जानकारी (ज़रूरी नहीं)',
  'report.note': 'थोड़ा बताइए कि समस्या क्या है…', 'report.send': 'रिपोर्ट भेजें', 'report.done': 'रिपोर्ट मिल गई। शुक्रिया।', 'report.dup': 'आप यह पहले ही रिपोर्ट कर चुके हैं।',
  'report.r.misleading': 'भ्रामक या ग़लत जानकारी', 'report.r.inappropriate': 'अनुचित या अपमानजनक', 'report.r.spam': 'स्पैम / विज्ञापन',
  'report.r.contact': 'संपर्क जानकारी माँग रहा/रही है', 'report.r.wrong_ref': 'ग़लत क़ुरआन/हदीस का हवाला', 'report.r.other': 'कुछ और',
  'share.copied': 'लिंक कॉपी हो गया।', 'share.copy': 'यह लिंक कॉपी करें:',

  'n.answer': '{scholar} ने आपके सवाल का जवाब दिया।', 'n.followed': '{scholar} ने एक नया जवाब दिया।',
  'n.status.open': 'आपका सवाल मंज़ूर हो गया और अब सबको दिख रहा है।', 'n.status.answered': 'आपके सवाल का जवाब आ गया है।',
  'n.status.rejected': 'आपका सवाल मंज़ूर नहीं हुआ।', 'n.status.pending_review': 'आपका सवाल जाँच में है।',
  'n.premium': 'आपको Premium मिल गया है। शुक्रिया!', 'n.premium.on': 'आपका Premium चालू हो गया है।', 'n.system': 'Alfrzo Ilm की तरफ़ से सूचना।',
  'n.scholar.ok': 'बधाई! आपका आलिम खाता सत्यापित हो गया है।', 'n.scholar.no': 'आपका आलिम आवेदन अभी मंज़ूर नहीं हुआ।',
  'n.empty': 'अभी कोई सूचना नहीं है।', 'n.markall': 'सब पढ़ा हुआ करें', 'n.allread': 'सभी सूचनाएँ पढ़ी हुई हो गईं।', 'n.note': 'कौन-सी सूचनाएँ चाहिए, यह',

  'prof.guest': 'Alfrzo Ilm में आपका स्वागत है', 'prof.guest.d': 'सवाल पूछने, जवाब सेव करने और आलिमों को फ़ॉलो करने के लिए लॉगिन करें।',
  'prof.myq': 'मेरे सवाल', 'prof.saved': 'सेव', 'prof.following': 'फ़ॉलोइंग', 'logout.done': 'आप लॉगआउट हो गए।', 'login.needed': 'इसके लिए पहले लॉगिन करें।',

  'auth.login': 'लॉगिन', 'auth.signup': 'साइन अप', 'auth.forgot': 'पासवर्ड भूल गए?', 'auth.reset': 'नया पासवर्ड',
  'auth.login.h': 'वापसी पर स्वागत है', 'auth.login.d': 'अपने खाते में लॉगिन करें।',
  'auth.signup.h': 'नया खाता बनाइए', 'auth.signup.d': 'सवाल पूछने के लिए खाता चाहिए। आपका नाम गुप्त रखा जा सकता है।',
  'auth.name': 'आपका नाम (उपनाम भी चलेगा)', 'auth.pw.hint': 'कम से कम 8 अक्षर। अक्षर और अंक मिलाकर रखें।',
  'auth.agree': 'मैं नियम और निजता नीति से सहमत हूँ:', 'auth.err.agree': 'आगे बढ़ने के लिए सहमति ज़रूरी है।', 'auth.err.name': 'कृपया अपना नाम लिखें।',
  'auth.noacct': 'खाता नहीं है?', 'auth.haveacct': 'पहले से खाता है?', 'auth.welcome': 'स्वागत है!', 'auth.slow': 'कई बार ग़लत पासवर्ड। कुछ सेकंड इंतज़ार करें…',
  'auth.check.t': 'अपना ईमेल देखिए', 'auth.check.d': 'हमने {email} पर एक लिंक भेजा है। उस पर क्लिक करके आगे बढ़ें। न मिले तो स्पैम फ़ोल्डर देखें।',
  'auth.forgot.h': 'पासवर्ड रीसेट', 'auth.forgot.d': 'अपना ईमेल लिखें, हम रीसेट लिंक भेजेंगे।', 'auth.forgot.send': 'रीसेट लिंक भेजें',
  'auth.forgot.done': 'अगर यह ईमेल हमारे पास है, तो रीसेट लिंक भेज दिया गया है।',
  'auth.reset.h': 'नया पासवर्ड बनाइए', 'auth.reset.d': 'अपना नया पासवर्ड लिखें।', 'auth.newpw': 'नया पासवर्ड', 'auth.reset.save': 'पासवर्ड सहेजें',
  'auth.reset.done': 'पासवर्ड बदल गया।', 'auth.reset.expired': 'यह लिंक पुराना हो गया है। कृपया दोबारा रीसेट लिंक माँगें।',

  'err.generic': 'कुछ गड़बड़ हो गई। दोबारा कोशिश करें।', 'err.load': 'डेटा नहीं खुल पाया।', 'err.network': 'इंटरनेट की समस्या है। कनेक्शन जाँचकर दोबारा कोशिश करें।',
  'err.login': 'ईमेल या पासवर्ड ग़लत है।', 'err.exists': 'इस ईमेल से खाता पहले से है। लॉगिन करें।', 'err.unconfirmed': 'पहले अपना ईमेल पक्का कीजिए (आपके इनबॉक्स में लिंक भेजा गया है)।',
  'err.weak': 'पासवर्ड कम से कम 8 अक्षर का रखें।', 'err.forbidden': 'आपको इसकी इजाज़त नहीं है।', 'err.dup': 'यह पहले से मौजूद है।',
  'err.rate': 'आप बहुत जल्दी-जल्दी कोशिश कर रहे हैं। कुछ देर बाद दोबारा करें।', 'err.suspended': 'आपका खाता रोका गया है। जानकारी के लिए संपर्क करें।',
  'err.notopen': 'यह सवाल अभी जवाब के लिए खुला नहीं है।', 'err.contact': 'निजता की सुरक्षा के लिए फ़ोन नंबर, ईमेल या लिंक न लिखें।',

  'privacy.link': 'निजता नीति', 'privacy.title': 'निजता और सुरक्षा',
  'prem.title': 'Alfrzo Ilm Premium', 'prem.upgrade': 'अपग्रेड',
  'set.title': 'सेटिंग्स', 'dash.title': 'आलिम डैशबोर्ड', 'admin.title': 'एडमिन पैनल', 'bs.title': 'आलिम के रूप में जुड़ें',
};

const en = {
  tagline: 'Ask questions, gain knowledge',
  skip: 'Skip to main content',
  back: 'Back', retry: 'Try again', cancel: 'Cancel', delete: 'Delete', edit: 'Edit', filter: 'Filter',
  email: 'Email', password: 'Password', login: 'Log in', signup: 'Sign up', logout: 'Log out', search: 'Search',
  loadmore: 'Load more', viewall: 'View all', like: 'Like', save: 'Save', share: 'Share', report: 'Report', helpful: 'Helpful',
  follow: 'Follow', followers: 'followers', answers: 'answers', scholar: 'Scholar', verified: 'Verified scholar', notfound: 'This page was not found.',
  'lang.title': 'Language / भाषा', 'lang.cur': 'English', 'lang.switch': 'Switch language',

  'nav.home': 'Home', 'nav.qa': 'Q&A', 'nav.ask': 'Ask', 'nav.scholars': 'Scholars', 'nav.profile': 'Profile', 'nav.notifications': 'Notifications',

  'meta.home': 'Alfrzo Ilm: ask your Islamic questions and get answers from verified scholars and muftis. Your identity stays private.',
  'meta.feed': 'Answers to Islamic questions on prayer, fasting, zakat, marriage, halal and haram and more, by verified scholars.',
  'meta.ask': 'Ask your Islamic question anonymously. Qualified scholars will answer.',
  'meta.scholars': 'Verified scholars and muftis on Alfrzo Ilm, with their qualifications and answers.',

  'home.h1a': 'Ask your Islamic questions,', 'home.h1b': 'get answers from a scholar.',
  'home.sub': 'Your identity stays private. Answers come from verified scholars.',
  'home.search': 'Type your question here…', 'home.ask': 'Ask a question', 'home.cats': 'Categories', 'home.latest': 'Latest questions & answers',
  'home.popular': 'Popular topics', 'home.scholars': 'Featured verified scholars', 'home.trust': 'Privacy & trust',
  'home.noq': 'No questions yet. Be the first to ask!', 'home.nopop': 'No popular questions yet.',
  'trust.anon.t': 'Anonymous questions', 'trust.anon.d': 'Your name is hidden from everyone, including scholars and other users.',
  'trust.phone.t': 'Phone number never public', 'trust.phone.d': 'We never ask for your phone number and block numbers from being written in questions.',
  'trust.verified.t': 'Verified scholars', 'trust.verified.d': 'An administrator checks every scholar\'s credentials before they can answer.',
  'trust.refs.t': 'Careful references', 'trust.refs.d': 'Scholars confirm Quran and Hadith references themselves before publishing.',

  'cat.all': 'All', 'cat.more': 'More', 'cat.title': 'Categories',
  'tab.latest': 'Latest', 'tab.popular': 'Popular', 'tab.following': 'Following',
  'st.all': 'All', 'st.answered': 'Answered', 'st.open': 'Awaiting answer', 'st.pending': 'In review', 'st.rejected': 'Rejected',
  'feed.search': 'Search questions…', 'feed.empty': 'No questions match this filter.', 'feed.nofollow': 'You are not following any scholar yet. Follow scholars to see their answers here.',

  'ask.title': 'Ask a question', 'ask.q': 'Your question', 'ask.ph': 'Write your question here… (हिन्दी / English / اردو)',
  'ask.detail': 'More details (optional)', 'ask.detail.ph': 'Add details that help explain the question. Do not write phone numbers or addresses.',
  'ask.cat': 'Category', 'ask.pickcat': 'Choose a category', 'ask.lang': 'Question language', 'ask.img': 'Image (optional)',
  'ask.img.type': 'Please choose a JPG, PNG or WebP image.', 'ask.img.size': 'The image must be smaller than 2 MB.',
  'ask.img.warn': 'The image stays private: only you, verified scholars and admins can see it. Avoid names and faces.',
  'ask.anon': 'Stay anonymous', 'ask.anon.d': 'Your name will not be shown with the question.', 'ask.anon.short': 'Anonymous',
  'ask.privacy': 'Your phone number and email are never made public. Questions are reviewed before they appear to everyone.',
  'ask.submit': 'Submit question', 'ask.sending': 'Sending…', 'ask.err.short': 'Please write at least 10 characters.', 'ask.err.cat': 'Please choose a category.',
  'ask.done.t': 'Question received', 'ask.done.d': 'Your question is being reviewed. Once approved it appears for everyone, and you will be notified when it is answered.', 'ask.another': 'Ask another question',

  'my.q': 'My questions', 'my.empty': 'You have not asked any questions yet.',
  'my.status.pending_review': 'Your question is under review. It will be visible once approved.', 'my.status.open': 'Your question is public and waiting for a scholar to answer.',
  'my.status.answered': 'This question has been answered.', 'my.status.rejected': 'This question was not approved under our guidelines.',
  'my.delete': 'Delete question', 'my.delete.d': 'This question and its answers will be removed permanently. Are you sure?', 'my.deleted': 'Question deleted.',

  'qd.title': 'Question & answers', 'qd.answers': 'Scholar answers', 'qd.unanswered': 'This question has not been answered yet.', 'qd.notpublic': 'This question is not public yet.',
  'qd.notfound': 'This question was not found or you cannot view it.', 'qd.img': 'Image attached to the question', 'qd.img.private': 'This question has a private image.',
  'qd.disc': 'This answer is general guidance. For your particular situation, please consult a qualified scholar you trust.',
  'qd.disc.strong': 'This matter depends on circumstances (marriage, family, inheritance, zakat, hajj, creed, halal and haram). Please consult a qualified local mufti in person or by phone before deciding.',
  'ans.quran': 'Quran', 'ans.hadith': 'Hadith', 'ans.edited': 'edited', 'ans.refs.note': 'The scholar personally verified these references.',

  'sa.write': 'Write an answer', 'sa.edit': 'Edit answer', 'sa.answer': 'Your answer', 'sa.ph': 'Write the answer here, in clear and simple language, with evidence.',
  'sa.quran.ph': 'e.g. Surah Al-Baqarah 2:183 (only what you have verified)', 'sa.hadith.ph': 'e.g. Sahih al-Bukhari, Hadith 1 (with book and number)',
  'sa.verify': 'I have verified every Quran and Hadith reference above against the original source.', 'sa.publish': 'Publish answer', 'sa.update': 'Save answer',
  'sa.published': 'Answer published.', 'sa.updated': 'Answer updated.', 'sa.err.short': 'Please write at least 10 characters.',
  'sa.err.verify': 'You added references, so please tick the verification box first.',
  'sa.rules': 'Rules: never cite a reference you have not checked, never invent one, do not share phone numbers, links or contact details, and say clearly when you do not know.',
  'sa.notverified': 'Your scholar account is not verified yet. You can answer once it is verified.',

  'saved.title': 'Saved answers', 'saved.empty': 'You have not saved any answers yet.', 'saved.added': 'Answer saved.', 'saved.removed': 'Removed from saved.', 'saved.remove': 'Remove',
  'save.noanswer': 'You can save once it is answered',

  'sch.title': 'Scholars / Muftis', 'sch.search': 'Search scholars…', 'sch.profile': 'Scholar profile', 'sch.bio': 'About', 'sch.published': 'Published answers',
  'sch.noans': 'No answers published yet.', 'sch.nomatch': 'No scholars match this search.', 'sch.notfound': 'Scholar profile not found.',
  'sch.pending': 'Pending verification', 'scholars.none': 'There are no verified scholars yet.',
  'follow.on': 'Following', 'following.on': 'Following', 'following.title': 'Followed scholars', 'following.empty': 'You are not following any scholars yet.',

  'search.hint': 'Type any word to search, for example: roza, zakat, nikah.', 'search.none': 'No questions found. You can ask a new one.',
  'search.recent': 'Recent searches', 'search.count': '{n} results',

  'report.title': 'Report', 'report.help': 'If this content is wrong, misleading or inappropriate, let us know. An admin will review it.', 'report.reason': 'Reason', 'report.more': 'More details (optional)',
  'report.note': 'Tell us briefly what the problem is…', 'report.send': 'Send report', 'report.done': 'Report received. Thank you.', 'report.dup': 'You have already reported this.',
  'report.r.misleading': 'Misleading or wrong information', 'report.r.inappropriate': 'Inappropriate or abusive', 'report.r.spam': 'Spam / advertising',
  'report.r.contact': 'Asking for contact details', 'report.r.wrong_ref': 'Wrong Quran/Hadith reference', 'report.r.other': 'Something else',
  'share.copied': 'Link copied.', 'share.copy': 'Copy this link:',

  'n.answer': '{scholar} answered your question.', 'n.followed': '{scholar} posted a new answer.',
  'n.status.open': 'Your question was approved and is now public.', 'n.status.answered': 'Your question has been answered.',
  'n.status.rejected': 'Your question was not approved.', 'n.status.pending_review': 'Your question is under review.',
  'n.premium': 'You have been given Premium. Thank you!', 'n.premium.on': 'Your Premium is now active.', 'n.system': 'A notice from Alfrzo Ilm.',
  'n.scholar.ok': 'Congratulations! Your scholar account is verified.', 'n.scholar.no': 'Your scholar application was not approved yet.',
  'n.empty': 'No notifications yet.', 'n.markall': 'Mark all read', 'n.allread': 'All notifications marked as read.', 'n.note': 'Change your notification options in',

  'prof.guest': 'Welcome to Alfrzo Ilm', 'prof.guest.d': 'Log in to ask questions, save answers and follow scholars.',
  'prof.myq': 'My questions', 'prof.saved': 'Saved', 'prof.following': 'Following', 'logout.done': 'You have been logged out.', 'login.needed': 'Please log in first.',

  'auth.login': 'Log in', 'auth.signup': 'Sign up', 'auth.forgot': 'Forgot password?', 'auth.reset': 'New password',
  'auth.login.h': 'Welcome back', 'auth.login.d': 'Log in to your account.',
  'auth.signup.h': 'Create your account', 'auth.signup.d': 'An account is needed to ask questions. Your name can stay hidden.',
  'auth.name': 'Your name (a nickname is fine)', 'auth.pw.hint': 'At least 8 characters. Mix letters and numbers.',
  'auth.agree': 'I agree to the terms and the privacy policy:', 'auth.err.agree': 'You need to agree to continue.', 'auth.err.name': 'Please enter your name.',
  'auth.noacct': 'No account?', 'auth.haveacct': 'Already have an account?', 'auth.welcome': 'Welcome!', 'auth.slow': 'Too many wrong attempts. Please wait a few seconds…',
  'auth.check.t': 'Check your email', 'auth.check.d': 'We sent a link to {email}. Click it to continue. If you do not see it, check your spam folder.',
  'auth.forgot.h': 'Reset password', 'auth.forgot.d': 'Enter your email and we will send a reset link.', 'auth.forgot.send': 'Send reset link',
  'auth.forgot.done': 'If this email is registered, a reset link has been sent.',
  'auth.reset.h': 'Create a new password', 'auth.reset.d': 'Enter your new password.', 'auth.newpw': 'New password', 'auth.reset.save': 'Save password',
  'auth.reset.done': 'Password changed.', 'auth.reset.expired': 'This link has expired. Please request a new reset link.',

  'err.generic': 'Something went wrong. Please try again.', 'err.load': 'Could not load data.', 'err.network': 'Network problem. Check your connection and try again.',
  'err.login': 'Wrong email or password.', 'err.exists': 'An account with this email already exists. Please log in.', 'err.unconfirmed': 'Please confirm your email first (a link was sent to your inbox).',
  'err.weak': 'Use a password of at least 8 characters.', 'err.forbidden': 'You are not allowed to do this.', 'err.dup': 'This already exists.',
  'err.rate': 'You are trying too fast. Please wait a while and try again.', 'err.suspended': 'Your account has been suspended. Please contact support.',
  'err.notopen': 'This question is not open for answers yet.', 'err.contact': 'To protect privacy, do not write phone numbers, emails or links.',

  'privacy.link': 'Privacy policy', 'privacy.title': 'Privacy & safety',
  'prem.title': 'Alfrzo Ilm Premium', 'prem.upgrade': 'Upgrade',
  'set.title': 'Settings', 'dash.title': 'Scholar dashboard', 'admin.title': 'Admin panel', 'bs.title': 'Join as a scholar',
};

const DICT = { hi, en };
let lang = 'hi';

export const getLang = () => lang;
export function setLang(l) {
  lang = DICT[l] ? l : 'hi';
  safe(() => localStorage.setItem(KEY, lang));
  safe(() => { document.documentElement.lang = lang; });
}
// First visit: Hindi (the app is Hindi-first; many phones in India run in English). Not persisted until the person chooses.
export function initLang() {
  const saved = safe(() => localStorage.getItem(KEY));
  lang = DICT[saved] ? saved : 'hi';
  safe(() => { document.documentElement.lang = lang; });
}
export function t(key, params) {
  let s = DICT[lang][key] ?? DICT.en[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ''));
  return s;
}
export const addStrings = (h, e) => { Object.assign(hi, h); Object.assign(en, e); };
