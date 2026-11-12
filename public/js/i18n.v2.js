// Texts for the v2 screens: new shell, home feed, explore, consultations, messages, reels.
import { addStrings } from './i18n.js';

addStrings({
  'nav.explore': 'खोजें', 'nav.messages': 'संदेश', 'menu.open': 'मेन्यू', 'menu.browse': 'जवाब देखें', 'menu.book': 'मशविरा बुक करें', 'menu.plans': 'मेंबरशिप',
  'menu.about': 'निजता और जानकारी', 'menu.reels': 'रील्स', 'menu.consults': 'मेरी बुकिंग',
  'home.today': 'आज का सवाल', 'home.foryou': 'आपके लिए', 'tab.all': 'सभी', 'tab.recent': 'नए', 'post.more': 'पूरा पढ़ें', 'home.reels': 'रील्स देखें', 'home.noans': 'अभी कोई जवाब नहीं आया है। पहला सवाल आप पूछिए!',
  'ex.popular': 'लोकप्रिय सवाल', 'ex.cats': 'श्रेणियाँ', 'ex.scholars': 'हमारे आलिम',
  'ask.mode.general': 'आम', 'ask.mode.private': 'निजी', 'ask.mode.priority': 'प्राथमिकता',
  'ask.private.d': 'निजी सवाल सिर्फ़ आप, सत्यापित आलिम (ताकि कोई जवाब दे सके) और एडमिन देख सकते हैं। आलिमों को आपका नाम या ईमेल नहीं दिखता। यह सबके सामने नहीं आता।',
  'ask.priority.on': 'आपका Premium चालू है: आपके सवाल आलिमों की कतार में ऊपर रहते हैं।', 'ask.priority.off': 'प्राथमिकता Premium के साथ मिलती है।', 'qd.private': 'निजी',

  'consult.title': 'मशविरा बुक करें', 'consult.type': 'मशविरे का तरीक़ा चुनें', 'consult.audio': 'ऑडियो कॉल', 'consult.video': 'वीडियो कॉल', 'consult.chat': 'चैट',
  'consult.free': 'मुफ़्त', 'consult.min': '{n} मिनट', 'consult.date': 'तारीख़ चुनें', 'consult.time': 'समय चुनें',
  'consult.noslots': 'इस आलिम ने अभी कोई समय नहीं खोला है।', 'consult.noservices': 'यह आलिम अभी मशविरा नहीं दे रहे।',
  'consult.topic': 'किस बारे में बात करनी है (ज़रूरी नहीं)', 'consult.topic.ph': 'थोड़े शब्दों में लिखें। फ़ोन नंबर या लिंक न लिखें।',
  'consult.total': 'कुल रक़म', 'consult.book': 'बुक करें', 'consult.pay': 'भुगतान करें', 'consult.booked': 'बुकिंग पक्की हो गई।',
  'consult.payoff': 'ऑनलाइन भुगतान अभी चालू नहीं है, इसलिए अभी सिर्फ़ मुफ़्त मशविरा बुक हो सकता है।',
  'consult.mine': 'मेरी बुकिंग', 'consult.empty': 'आपकी कोई बुकिंग नहीं है।', 'consult.find': 'आलिम देखें',
  'consult.st.pending_payment': 'भुगतान बाक़ी', 'consult.st.confirmed': 'पक्की', 'consult.st.completed': 'पूरी हुई', 'consult.st.cancelled': 'रद्द',
  'consult.cancel': 'बुकिंग रद्द करें', 'consult.cancel.d': 'यह बुकिंग रद्द हो जाएगी। अगर भुगतान हुआ है तो रिफ़ंड एडमिन करेंगे।', 'consult.cancelled': 'बुकिंग रद्द हो गई।',
  'consult.join': 'कॉल से जुड़ें', 'consult.joinhint': 'कॉल का बटन तय समय से 10 मिनट पहले खुलेगा। कॉल एक अलग वेबसाइट पर खुलती है।', 'consult.chatopen': 'चैट खोलें',
  'consult.refund': 'रिफ़ंड बाक़ी', 'consult.anon': 'गुमनाम यूज़र', 'consult.holdnote': 'भुगतान 15 मिनट में पूरा करें, नहीं तो यह समय छूट जाएगा।',

  'msg.title': 'संदेश', 'msg.empty': 'अभी कोई बातचीत नहीं है। मशविरा बुक करने पर आलिम से बातचीत यहाँ खुलती है।', 'msg.active': 'चालू', 'msg.past': 'पुरानी',
  'msg.ph': 'संदेश लिखें…', 'msg.send': 'भेजें', 'msg.closed': 'यह बातचीत बंद है, अब संदेश नहीं भेजे जा सकते।', 'msg.none': 'अभी कोई संदेश नहीं। सलाम से शुरुआत कीजिए।',
  'msg.rule': 'निजता के लिए फ़ोन नंबर, ईमेल या लिंक शेयर नहीं किए जा सकते।', 'msg.report': 'बातचीत रिपोर्ट करें',

  'reel.title': 'रील्स', 'reel.empty': 'अभी कोई रील नहीं है।', 'reel.sound': 'आवाज़ चालू/बंद', 'reel.upload': 'रील अपलोड करें', 'reel.caption': 'कैप्शन',
  'reel.caption.ph': 'इस वीडियो में क्या बताया गया है…', 'reel.file': 'वीडियो (MP4 या WebM, 30 MB तक)', 'reel.file.err': 'सिर्फ़ MP4 या WebM वीडियो, 30 MB से छोटा।',
  'reel.uploading': 'अपलोड हो रहा है…', 'reel.uploaded': 'रील छप गई।', 'reel.deleted': 'रील हटा दी गई।', 'reel.mine': 'मेरी रील्स', 'reel.none': 'आपने अभी कोई रील नहीं डाली।', 'reel.err.caption': 'कैप्शन कम से कम 3 अक्षर का लिखें।',

  'dash.consults': 'मशविरे', 'dash.reels': 'रील्स', 'dash.svc': 'मेरी सेवाएँ', 'dash.svc.d': 'जो तरीक़ा चालू करेंगे वही लोगों को बुकिंग के लिए दिखेगा। क़ीमत 0 रखने पर मशविरा मुफ़्त होगा।',
  'dash.price': 'क़ीमत (₹)', 'dash.duration': 'अवधि', 'dash.slots': 'खुले समय', 'dash.addslot': 'समय जोड़ें', 'dash.slot.added': 'समय जुड़ गया।', 'dash.slot.err': 'आगे की कोई तारीख़ और समय चुनें।',
  'dash.noslots': 'आपने अभी कोई समय नहीं खोला।', 'dash.bookings': 'बुकिंग', 'dash.nobookings': 'अभी कोई बुकिंग नहीं है।', 'dash.complete': 'पूरी हुई', 'dash.completed': 'बुकिंग पूरी दर्ज हो गई।',

  'n.message': 'आपके लिए नया संदेश आया है।', 'n.consult.confirmed': 'आपकी मशविरा बुकिंग पक्की हो गई।', 'n.consult.booked': 'आपके साथ एक नया मशविरा बुक हुआ है।', 'n.consult.cancelled': 'एक मशविरा बुकिंग रद्द हो गई।',
  'prof.consults': 'मशविरे',
  'pv.chat.t': 'मशविरा और संदेश', 'pv.chat.d': 'आलिम से बातचीत सिर्फ़ बुक किए गए मशविरे के अंदर खुलती है और सिर्फ़ आप दोनों को दिखती है। फ़ोन नंबर, ईमेल और लिंक वहाँ भी रोके जाते हैं। शिकायत की जाँच के लिए एडमिन बातचीत पढ़ सकते हैं। अगर आप "गुमनाम" हैं तो आलिम को आपका नाम नहीं दिखता।',
  'pv.reels.t': 'रील्स', 'pv.reels.d': 'रील्स सिर्फ़ सत्यापित आलिम डाल सकते हैं और वे सबको दिखती हैं। ग़लत लगे तो रिपोर्ट कीजिए।',
}, {
  'nav.explore': 'Explore', 'nav.messages': 'Messages', 'menu.open': 'Menu', 'menu.browse': 'Browse answers', 'menu.book': 'Book consultation', 'menu.plans': 'Membership plans',
  'menu.about': 'Privacy & about', 'menu.reels': 'Reels', 'menu.consults': 'My bookings',
  'home.today': 'Aaj ka Sawal', 'home.foryou': 'For you', 'tab.all': 'All', 'tab.recent': 'Recent', 'post.more': 'Read more', 'home.reels': 'Watch reels', 'home.noans': 'No answers yet. Be the first to ask!',
  'ex.popular': 'Popular questions', 'ex.cats': 'Categories', 'ex.scholars': 'Our scholars',
  'ask.mode.general': 'General', 'ask.mode.private': 'Private', 'ask.mode.priority': 'Priority',
  'ask.private.d': 'Only you, verified scholars (so that one of them can answer) and admins can see a private question. Scholars never see your name or email. It never appears publicly.',
  'ask.priority.on': 'Your Premium is active: your questions stay higher in the scholars\' queue.', 'ask.priority.off': 'Priority comes with Premium.', 'qd.private': 'Private',

  'consult.title': 'Book consultation', 'consult.type': 'Select consultation type', 'consult.audio': 'Audio call', 'consult.video': 'Video call', 'consult.chat': 'Chat',
  'consult.free': 'Free', 'consult.min': '{n} minutes', 'consult.date': 'Select date', 'consult.time': 'Select time',
  'consult.noslots': 'This scholar has not opened any times yet.', 'consult.noservices': 'This scholar is not offering consultations right now.',
  'consult.topic': 'What would you like to discuss (optional)', 'consult.topic.ph': 'A few words. Do not write phone numbers or links.',
  'consult.total': 'Total amount', 'consult.book': 'Book now', 'consult.pay': 'Proceed to payment', 'consult.booked': 'Booking confirmed.',
  'consult.payoff': 'Online payments are not switched on yet, so only free consultations can be booked for now.',
  'consult.mine': 'My bookings', 'consult.empty': 'You have no bookings.', 'consult.find': 'Browse scholars',
  'consult.st.pending_payment': 'Payment pending', 'consult.st.confirmed': 'Confirmed', 'consult.st.completed': 'Completed', 'consult.st.cancelled': 'Cancelled',
  'consult.cancel': 'Cancel booking', 'consult.cancel.d': 'This booking will be cancelled. If it was paid, an admin will handle the refund.', 'consult.cancelled': 'Booking cancelled.',
  'consult.join': 'Join call', 'consult.joinhint': 'The call button opens 10 minutes before the start time. Calls open on a separate website.', 'consult.chatopen': 'Open chat',
  'consult.refund': 'Refund pending', 'consult.anon': 'Anonymous user', 'consult.holdnote': 'Please pay within 15 minutes or this time will be released.',

  'msg.title': 'Messages', 'msg.empty': 'No conversations yet. A conversation with a scholar opens here when you book a consultation.', 'msg.active': 'Active', 'msg.past': 'Past',
  'msg.ph': 'Type your message…', 'msg.send': 'Send', 'msg.closed': 'This conversation is closed. No more messages can be sent.', 'msg.none': 'No messages yet. Start with salam.',
  'msg.rule': 'For privacy, phone numbers, emails and links cannot be shared.', 'msg.report': 'Report conversation',

  'reel.title': 'Reels', 'reel.empty': 'No reels yet.', 'reel.sound': 'Sound on/off', 'reel.upload': 'Upload reel', 'reel.caption': 'Caption',
  'reel.caption.ph': 'What is this video about…', 'reel.file': 'Video (MP4 or WebM, up to 30 MB)', 'reel.file.err': 'Only MP4 or WebM video, smaller than 30 MB.',
  'reel.uploading': 'Uploading…', 'reel.uploaded': 'Reel published.', 'reel.deleted': 'Reel deleted.', 'reel.mine': 'My reels', 'reel.none': 'You have not posted any reels yet.', 'reel.err.caption': 'Write a caption of at least 3 characters.',

  'dash.consults': 'Consultations', 'dash.reels': 'Reels', 'dash.svc': 'My services', 'dash.svc.d': 'Only the types you switch on are shown for booking. A price of 0 makes the consultation free.',
  'dash.price': 'Price (₹)', 'dash.duration': 'Duration', 'dash.slots': 'Open times', 'dash.addslot': 'Add time', 'dash.slot.added': 'Time added.', 'dash.slot.err': 'Choose a date and time in the future.',
  'dash.noslots': 'You have not opened any times yet.', 'dash.bookings': 'Bookings', 'dash.nobookings': 'No bookings yet.', 'dash.complete': 'Mark completed', 'dash.completed': 'Booking marked completed.',

  'n.message': 'You have a new message.', 'n.consult.confirmed': 'Your consultation booking is confirmed.', 'n.consult.booked': 'A new consultation was booked with you.', 'n.consult.cancelled': 'A consultation booking was cancelled.',
  'prof.consults': 'Consultations',
  'pv.chat.t': 'Consultations and messages', 'pv.chat.d': 'A conversation with a scholar only opens inside a booked consultation and is visible only to the two of you. Phone numbers, emails and links are blocked there too. Administrators can read a conversation to investigate a complaint. If you are "anonymous", the scholar does not see your name.',
  'pv.reels.t': 'Reels', 'pv.reels.d': 'Only verified scholars can post reels, and they are public. If something looks wrong, report it.',
});

// v3 screens (all questions, question detail, profiles)
addStrings({
  'tab.unanswered': 'बिना जवाब', 'feed.all': 'सभी सवाल', 'qd.best': 'सबसे अच्छा जवाब', 'qd.more': 'दूसरे जवाब',
  'sch.tab.answers': 'जवाब', 'sch.tab.about': 'परिचय', 'sch.nobio': 'इन्होंने अभी अपना परिचय नहीं लिखा।', 'sch.verifiednote': 'एडमिन द्वारा सत्यापित आलिम',
  'prof.myq': 'सवाल', 'prof.title': 'मेरी प्रोफ़ाइल',
  'consult.hosthint': 'कॉल एक अलग वेबसाइट (Jitsi) पर खुलती है। कॉल शुरू करने वाले को वहाँ एक बार साइन इन करना पड़ सकता है।', 'prof.membership': 'मेरी मेंबरशिप', 'prof.edit': 'प्रोफ़ाइल बदलें',
}, {
  'tab.unanswered': 'Unanswered', 'feed.all': 'All questions', 'qd.best': 'Best answer', 'qd.more': 'More answers',
  'sch.tab.answers': 'Answers', 'sch.tab.about': 'About', 'sch.nobio': 'This scholar has not written an introduction yet.', 'sch.verifiednote': 'Scholar verified by an administrator',
  'prof.myq': 'Questions', 'prof.title': 'My profile',
  'consult.hosthint': 'The call opens on a separate website (Jitsi). Whoever starts the call may need to sign in there once.', 'prof.membership': 'My membership', 'prof.edit': 'Edit profile',
});
