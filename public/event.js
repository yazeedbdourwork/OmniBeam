// OmniBeam event photo album (/e/<id>#<key>, made in the app's ⋯ menu, Event photo album: album.js).
// Guests scan the album's QR code, add photos and videos, and see everyone's; the person who made it saves them all.
// The key comes from the part of the address after #, which never reaches the server. Everything is encrypted here
// with it (AES-GCM, each piece [12-byte random IV] + ciphertext): the album's name, each photo, its small picture for
// the grid, and its name and who added it. The server (server.js: handleAlbum) only stores encrypted bytes.
// "#<key>.<token>" is the host's own address (album.js opens it): the token lets it stop uploads and delete photos.
// ?poster=1 shows a page to print with the QR code.
'use strict';
(function () {
  const TEXT = {
    "ar": {
      "Event album": "ألبوم المناسبة",
      "Loading…": "جارٍ التحميل…",
      "Open OmniBeam": "افتح OmniBeam",
      "Your name (optional)": "اسمك (اختياري)",
      "Add photos and videos": "أضف صورًا ومقاطع فيديو",
      "Everyone with this link sees them": "يراها كل من لديه هذا الرابط",
      "Everyone with this link sees them. Up to {size} each.": "يراها كل من لديه هذا الرابط. حتى {size} لكل منها.",
      "Save all": "حفظ الكل",
      "Show QR code": "عرض رمز QR",
      "Copy link": "نسخ الرابط",
      "Link copied": "تم نسخ الرابط",
      "You made this album.": "أنت من أنشأ هذا الألبوم.",
      "Print poster": "طباعة ملصق",
      "Stop taking photos": "إيقاف استقبال الصور",
      "Take photos again": "استقبال الصور مجددًا",
      "Delete album": "حذف الألبوم",
      "End-to-end encrypted: photos are encrypted on the device that adds them, and only people with this link can see them. The OmniBeam server can't.": "مشفّر من طرف إلى طرف: تُشفَّر الصور على الجهاز الذي يضيفها، ولا يراها إلا من لديه هذا الرابط. خادم OmniBeam لا يستطيع ذلك.",
      "Make your own event album with OmniBeam: free, no app": "أنشئ ألبوم مناسبتك مع OmniBeam: مجانًا ودون تطبيق",
      "Scan to add your photos": "امسح الرمز لإضافة صورك",
      "No app needed: point your phone's camera at the code.": "لا حاجة إلى تطبيق: وجّه كاميرا هاتفك نحو الرمز.",
      "Previous": "السابق",
      "Next": "التالي",
      "Save": "حفظ",
      "Delete": "حذف",
      "Close": "إغلاق",
      "This link is incomplete. Copy the whole link, including the part after #.": "هذا الرابط غير مكتمل. انسخ الرابط كاملًا، بما في ذلك الجزء بعد #.",
      "Could not load this album. Check the connection and try again.": "تعذّر تحميل هذا الألبوم. تحقق من الاتصال وحاول مجددًا.",
      "This album has ended or was deleted.": "انتهى هذا الألبوم أو تم حذفه.",
      "1 photo": "صورة واحدة",
      "{n} photos": "{n} صور",
      "No photos yet. Add the first ones!": "لا توجد صور بعد. أضف أولى الصور!",
      "This album no longer takes new photos.": "لم يعد هذا الألبوم يستقبل صورًا جديدة.",
      "Open until {date}": "مفتوح حتى {date}",
      "Photo": "صورة",
      "Photos": "الصور",
      "Added from this device": "أُضيفت من هذا الجهاز",
      "Added by {name}": "أضافها {name}",
      "Could not load this photo. Check the connection and try again.": "تعذّر تحميل هذه الصورة. تحقق من الاتصال وحاول مجددًا.",
      "Delete this photo for everyone?": "حذف هذه الصورة لدى الجميع؟",
      "Could not delete it. Try again.": "تعذّر الحذف. حاول مجددًا.",
      "Getting photos… {pct}%": "جارٍ جلب الصور… {pct}%",
      "Save photos {a}–{b}": "حفظ الصور {a}–{b}",
      "{file} is too large: up to {size} each.": "{file} كبير جدًا: الحد {size} لكل ملف.",
      "Could not add {file}. Check the connection and try again.": "تعذّرت إضافة {file}. تحقق من الاتصال وحاول مجددًا.",
      "This album is full.": "هذا الألبوم ممتلئ.",
      "Too many photos at once. Try again in a few minutes.": "صور كثيرة في وقت واحد. حاول بعد بضع دقائق.",
      "1 photo added ✓": "تمت إضافة صورة واحدة ✓",
      "{n} photos added ✓": "تمت إضافة {n} صور ✓",
      "Adding {i} of {n}…": "جارٍ إضافة {i} من {n}…",
      "Could not change it. Try again.": "تعذّر التغيير. حاول مجددًا.",
      "Delete this album and all its photos for everyone?": "حذف هذا الألبوم وكل صوره لدى الجميع؟",
      "Album deleted": "تم حذف الألبوم",
      "The host stopped taking new photos. You can still see and save the ones in the album.": "أوقف صاحب الألبوم استقبال صور جديدة. لا يزال بإمكانك رؤية الصور الموجودة في الألبوم وحفظها."
    },
    "de": {
      "Event album": "Event-Album",
      "Loading…": "Wird geladen…",
      "Open OmniBeam": "OmniBeam öffnen",
      "Your name (optional)": "Dein Name (optional)",
      "Add photos and videos": "Fotos und Videos hinzufügen",
      "Everyone with this link sees them": "Alle mit diesem Link sehen sie",
      "Everyone with this link sees them. Up to {size} each.": "Alle mit diesem Link sehen sie. Bis zu {size} pro Datei.",
      "Save all": "Alle speichern",
      "Show QR code": "QR-Code zeigen",
      "Copy link": "Link kopieren",
      "Link copied": "Link kopiert",
      "You made this album.": "Du hast dieses Album erstellt.",
      "Print poster": "Poster drucken",
      "Stop taking photos": "Keine Fotos mehr annehmen",
      "Take photos again": "Wieder Fotos annehmen",
      "Delete album": "Album löschen",
      "End-to-end encrypted: photos are encrypted on the device that adds them, and only people with this link can see them. The OmniBeam server can't.": "Ende-zu-Ende-verschlüsselt: Fotos werden auf dem Gerät verschlüsselt, das sie hinzufügt, und nur Personen mit diesem Link können sie sehen. Der OmniBeam-Server nicht.",
      "Make your own event album with OmniBeam: free, no app": "Erstelle dein eigenes Event-Album mit OmniBeam: kostenlos, ohne App",
      "Scan to add your photos": "Scannen und deine Fotos hinzufügen",
      "No app needed: point your phone's camera at the code.": "Keine App nötig: Richte die Kamera deines Handys auf den Code.",
      "Previous": "Zurück",
      "Next": "Weiter",
      "Save": "Speichern",
      "Delete": "Löschen",
      "Close": "Schließen",
      "This link is incomplete. Copy the whole link, including the part after #.": "Dieser Link ist unvollständig. Kopiere den ganzen Link, auch den Teil nach #.",
      "Could not load this album. Check the connection and try again.": "Das Album konnte nicht geladen werden. Prüfe die Verbindung und versuch es noch einmal.",
      "This album has ended or was deleted.": "Dieses Album ist abgelaufen oder wurde gelöscht.",
      "1 photo": "1 Foto",
      "{n} photos": "{n} Fotos",
      "No photos yet. Add the first ones!": "Noch keine Fotos. Füge die ersten hinzu!",
      "This album no longer takes new photos.": "Dieses Album nimmt keine neuen Fotos mehr an.",
      "Open until {date}": "Offen bis {date}",
      "Photo": "Foto",
      "Photos": "Fotos",
      "Added from this device": "Von diesem Gerät hinzugefügt",
      "Added by {name}": "Hinzugefügt von {name}",
      "Could not load this photo. Check the connection and try again.": "Das Foto konnte nicht geladen werden. Prüfe die Verbindung und versuch es noch einmal.",
      "Delete this photo for everyone?": "Dieses Foto für alle löschen?",
      "Could not delete it. Try again.": "Löschen hat nicht geklappt. Versuch es noch einmal.",
      "Getting photos… {pct}%": "Fotos werden geholt… {pct} %",
      "Save photos {a}–{b}": "Fotos {a}–{b} speichern",
      "{file} is too large: up to {size} each.": "{file} ist zu groß: höchstens {size} pro Datei.",
      "Could not add {file}. Check the connection and try again.": "{file} konnte nicht hinzugefügt werden. Prüfe die Verbindung und versuch es noch einmal.",
      "This album is full.": "Dieses Album ist voll.",
      "Too many photos at once. Try again in a few minutes.": "Zu viele Fotos auf einmal. Versuch es in ein paar Minuten noch einmal.",
      "1 photo added ✓": "1 Foto hinzugefügt ✓",
      "{n} photos added ✓": "{n} Fotos hinzugefügt ✓",
      "Adding {i} of {n}…": "{i} von {n} wird hinzugefügt…",
      "Could not change it. Try again.": "Das hat nicht geklappt. Versuch es noch einmal.",
      "Delete this album and all its photos for everyone?": "Dieses Album und alle seine Fotos für alle löschen?",
      "Album deleted": "Album gelöscht",
      "The host stopped taking new photos. You can still see and save the ones in the album.": "Der Gastgeber nimmt keine neuen Fotos mehr an. Du kannst die Fotos im Album weiterhin ansehen und speichern."
    },
    "es": {
      "Event album": "Álbum del evento",
      "Loading…": "Cargando…",
      "Open OmniBeam": "Abrir OmniBeam",
      "Your name (optional)": "Tu nombre (opcional)",
      "Add photos and videos": "Añadir fotos y vídeos",
      "Everyone with this link sees them": "Todos los que tengan este enlace las ven",
      "Everyone with this link sees them. Up to {size} each.": "Todos los que tengan este enlace las ven. Hasta {size} cada una.",
      "Save all": "Guardar todo",
      "Show QR code": "Mostrar código QR",
      "Copy link": "Copiar enlace",
      "Link copied": "Enlace copiado",
      "You made this album.": "Tú creaste este álbum.",
      "Print poster": "Imprimir cartel",
      "Stop taking photos": "Dejar de recibir fotos",
      "Take photos again": "Volver a recibir fotos",
      "Delete album": "Eliminar álbum",
      "End-to-end encrypted: photos are encrypted on the device that adds them, and only people with this link can see them. The OmniBeam server can't.": "Cifrado de extremo a extremo: las fotos se cifran en el dispositivo que las añade y solo las ve quien tenga este enlace. El servidor de OmniBeam no puede.",
      "Make your own event album with OmniBeam: free, no app": "Crea tu propio álbum de evento con OmniBeam: gratis, sin app",
      "Scan to add your photos": "Escanea para añadir tus fotos",
      "No app needed: point your phone's camera at the code.": "No hace falta ninguna app: apunta la cámara del teléfono al código.",
      "Previous": "Anterior",
      "Next": "Siguiente",
      "Save": "Guardar",
      "Delete": "Eliminar",
      "Close": "Cerrar",
      "This link is incomplete. Copy the whole link, including the part after #.": "Este enlace está incompleto. Copia el enlace completo, incluida la parte después de #.",
      "Could not load this album. Check the connection and try again.": "No se pudo cargar el álbum. Revisa la conexión e inténtalo de nuevo.",
      "This album has ended or was deleted.": "Este álbum terminó o se eliminó.",
      "1 photo": "1 foto",
      "{n} photos": "{n} fotos",
      "No photos yet. Add the first ones!": "Aún no hay fotos. ¡Añade las primeras!",
      "This album no longer takes new photos.": "Este álbum ya no acepta fotos nuevas.",
      "Open until {date}": "Abierto hasta el {date}",
      "Photo": "Foto",
      "Photos": "Fotos",
      "Added from this device": "Añadida desde este dispositivo",
      "Added by {name}": "Añadida por {name}",
      "Could not load this photo. Check the connection and try again.": "No se pudo cargar la foto. Revisa la conexión e inténtalo de nuevo.",
      "Delete this photo for everyone?": "¿Eliminar esta foto para todos?",
      "Could not delete it. Try again.": "No se pudo eliminar. Inténtalo de nuevo.",
      "Getting photos… {pct}%": "Obteniendo fotos… {pct} %",
      "Save photos {a}–{b}": "Guardar fotos {a}–{b}",
      "{file} is too large: up to {size} each.": "{file} es demasiado grande: hasta {size} cada uno.",
      "Could not add {file}. Check the connection and try again.": "No se pudo añadir {file}. Revisa la conexión e inténtalo de nuevo.",
      "This album is full.": "Este álbum está lleno.",
      "Too many photos at once. Try again in a few minutes.": "Demasiadas fotos a la vez. Inténtalo dentro de unos minutos.",
      "1 photo added ✓": "1 foto añadida ✓",
      "{n} photos added ✓": "{n} fotos añadidas ✓",
      "Adding {i} of {n}…": "Añadiendo {i} de {n}…",
      "Could not change it. Try again.": "No se pudo cambiar. Inténtalo de nuevo.",
      "Delete this album and all its photos for everyone?": "¿Eliminar este álbum y todas sus fotos para todos?",
      "Album deleted": "Álbum eliminado",
      "The host stopped taking new photos. You can still see and save the ones in the album.": "El anfitrión dejó de recibir fotos nuevas. Aún puedes ver y guardar las del álbum."
    },
    "fr": {
      "Event album": "Album de l'événement",
      "Loading…": "Chargement…",
      "Open OmniBeam": "Ouvrir OmniBeam",
      "Your name (optional)": "Votre nom (facultatif)",
      "Add photos and videos": "Ajouter des photos et vidéos",
      "Everyone with this link sees them": "Tous ceux qui ont ce lien les voient",
      "Everyone with this link sees them. Up to {size} each.": "Tous ceux qui ont ce lien les voient. {size} maximum chacune.",
      "Save all": "Tout enregistrer",
      "Show QR code": "Afficher le QR code",
      "Copy link": "Copier le lien",
      "Link copied": "Lien copié",
      "You made this album.": "Vous avez créé cet album.",
      "Print poster": "Imprimer l'affiche",
      "Stop taking photos": "Ne plus accepter de photos",
      "Take photos again": "Accepter à nouveau des photos",
      "Delete album": "Supprimer l'album",
      "End-to-end encrypted: photos are encrypted on the device that adds them, and only people with this link can see them. The OmniBeam server can't.": "Chiffré de bout en bout : les photos sont chiffrées sur l'appareil qui les ajoute, et seules les personnes ayant ce lien peuvent les voir. Le serveur OmniBeam ne le peut pas.",
      "Make your own event album with OmniBeam: free, no app": "Créez votre propre album d'événement avec OmniBeam : gratuit, sans appli",
      "Scan to add your photos": "Scannez pour ajouter vos photos",
      "No app needed: point your phone's camera at the code.": "Aucune appli nécessaire : pointez l'appareil photo de votre téléphone vers le code.",
      "Previous": "Précédent",
      "Next": "Suivant",
      "Save": "Enregistrer",
      "Delete": "Supprimer",
      "Close": "Fermer",
      "This link is incomplete. Copy the whole link, including the part after #.": "Ce lien est incomplet. Copiez le lien entier, y compris la partie après #.",
      "Could not load this album. Check the connection and try again.": "Impossible de charger cet album. Vérifiez la connexion et réessayez.",
      "This album has ended or was deleted.": "Cet album est terminé ou a été supprimé.",
      "1 photo": "1 photo",
      "{n} photos": "{n} photos",
      "No photos yet. Add the first ones!": "Pas encore de photos. Ajoutez les premières !",
      "This album no longer takes new photos.": "Cet album n'accepte plus de nouvelles photos.",
      "Open until {date}": "Ouvert jusqu'au {date}",
      "Photo": "Photo",
      "Photos": "Photos",
      "Added from this device": "Ajoutée depuis cet appareil",
      "Added by {name}": "Ajoutée par {name}",
      "Could not load this photo. Check the connection and try again.": "Impossible de charger cette photo. Vérifiez la connexion et réessayez.",
      "Delete this photo for everyone?": "Supprimer cette photo pour tout le monde ?",
      "Could not delete it. Try again.": "Impossible de supprimer. Réessayez.",
      "Getting photos… {pct}%": "Récupération des photos… {pct} %",
      "Save photos {a}–{b}": "Enregistrer les photos {a} à {b}",
      "{file} is too large: up to {size} each.": "{file} est trop volumineux : {size} maximum chacun.",
      "Could not add {file}. Check the connection and try again.": "Impossible d'ajouter {file}. Vérifiez la connexion et réessayez.",
      "This album is full.": "Cet album est plein.",
      "Too many photos at once. Try again in a few minutes.": "Trop de photos à la fois. Réessayez dans quelques minutes.",
      "1 photo added ✓": "1 photo ajoutée ✓",
      "{n} photos added ✓": "{n} photos ajoutées ✓",
      "Adding {i} of {n}…": "Ajout de {i} sur {n}…",
      "Could not change it. Try again.": "Impossible de modifier. Réessayez.",
      "Delete this album and all its photos for everyone?": "Supprimer cet album et toutes ses photos pour tout le monde ?",
      "Album deleted": "Album supprimé",
      "The host stopped taking new photos. You can still see and save the ones in the album.": "L'organisateur n'accepte plus de nouvelles photos. Vous pouvez toujours voir et enregistrer celles de l'album."
    },
    "hi": {
      "Event album": "इवेंट एल्बम",
      "Loading…": "लोड हो रहा है…",
      "Open OmniBeam": "OmniBeam खोलें",
      "Your name (optional)": "आपका नाम (वैकल्पिक)",
      "Add photos and videos": "फ़ोटो और वीडियो जोड़ें",
      "Everyone with this link sees them": "इस लिंक वाले सभी लोग इन्हें देखते हैं",
      "Everyone with this link sees them. Up to {size} each.": "इस लिंक वाले सभी लोग इन्हें देखते हैं। हर एक {size} तक।",
      "Save all": "सब सेव करें",
      "Show QR code": "QR कोड दिखाएँ",
      "Copy link": "लिंक कॉपी करें",
      "Link copied": "लिंक कॉपी हो गया",
      "You made this album.": "यह एल्बम आपने बनाया है।",
      "Print poster": "पोस्टर प्रिंट करें",
      "Stop taking photos": "फ़ोटो लेना बंद करें",
      "Take photos again": "फिर से फ़ोटो लें",
      "Delete album": "एल्बम हटाएँ",
      "End-to-end encrypted: photos are encrypted on the device that adds them, and only people with this link can see them. The OmniBeam server can't.": "एंड-टू-एंड एन्क्रिप्टेड: फ़ोटो जोड़ने वाले डिवाइस पर ही एन्क्रिप्ट होती हैं, और सिर्फ़ इस लिंक वाले लोग उन्हें देख सकते हैं। OmniBeam सर्वर नहीं देख सकता।",
      "Make your own event album with OmniBeam: free, no app": "OmniBeam से अपना इवेंट एल्बम बनाएँ: मुफ़्त, बिना ऐप",
      "Scan to add your photos": "अपनी फ़ोटो जोड़ने के लिए स्कैन करें",
      "No app needed: point your phone's camera at the code.": "ऐप की ज़रूरत नहीं: फ़ोन का कैमरा कोड की ओर करें।",
      "Previous": "पिछला",
      "Next": "अगला",
      "Save": "सेव करें",
      "Delete": "हटाएँ",
      "Close": "बंद करें",
      "This link is incomplete. Copy the whole link, including the part after #.": "यह लिंक अधूरा है। पूरा लिंक कॉपी करें, # के बाद वाला हिस्सा भी।",
      "Could not load this album. Check the connection and try again.": "यह एल्बम लोड नहीं हो सका। कनेक्शन जाँचें और फिर कोशिश करें।",
      "This album has ended or was deleted.": "यह एल्बम ख़त्म हो गया है या हटा दिया गया है।",
      "1 photo": "1 फ़ोटो",
      "{n} photos": "{n} फ़ोटो",
      "No photos yet. Add the first ones!": "अभी कोई फ़ोटो नहीं। पहली फ़ोटो जोड़ें!",
      "This album no longer takes new photos.": "यह एल्बम अब नई फ़ोटो नहीं लेता।",
      "Open until {date}": "{date} तक खुला",
      "Photo": "फ़ोटो",
      "Photos": "फ़ोटो",
      "Added from this device": "इस डिवाइस से जोड़ी गई",
      "Added by {name}": "{name} ने जोड़ी",
      "Could not load this photo. Check the connection and try again.": "यह फ़ोटो लोड नहीं हो सकी। कनेक्शन जाँचें और फिर कोशिश करें।",
      "Delete this photo for everyone?": "यह फ़ोटो सबके लिए हटाएँ?",
      "Could not delete it. Try again.": "हटाया नहीं जा सका। फिर कोशिश करें।",
      "Getting photos… {pct}%": "फ़ोटो ला रहे हैं… {pct}%",
      "Save photos {a}–{b}": "फ़ोटो {a}–{b} सेव करें",
      "{file} is too large: up to {size} each.": "{file} बहुत बड़ी है: हर एक {size} तक।",
      "Could not add {file}. Check the connection and try again.": "{file} नहीं जोड़ी जा सकी। कनेक्शन जाँचें और फिर कोशिश करें।",
      "This album is full.": "यह एल्बम भर गया है।",
      "Too many photos at once. Try again in a few minutes.": "एक साथ बहुत सारी फ़ोटो। कुछ मिनट बाद फिर कोशिश करें।",
      "1 photo added ✓": "1 फ़ोटो जोड़ी गई ✓",
      "{n} photos added ✓": "{n} फ़ोटो जोड़ी गईं ✓",
      "Adding {i} of {n}…": "{n} में से {i} जोड़ रहे हैं…",
      "Could not change it. Try again.": "बदला नहीं जा सका। फिर कोशिश करें।",
      "Delete this album and all its photos for everyone?": "यह एल्बम और इसकी सारी फ़ोटो सबके लिए हटाएँ?",
      "Album deleted": "एल्बम हटा दिया गया",
      "The host stopped taking new photos. You can still see and save the ones in the album.": "होस्ट ने नई फ़ोटो लेना बंद कर दिया है। एल्बम की फ़ोटो आप अब भी देख और सेव कर सकते हैं।"
    },
    "id": {
      "Event album": "Album acara",
      "Loading…": "Memuat…",
      "Open OmniBeam": "Buka OmniBeam",
      "Your name (optional)": "Nama Anda (opsional)",
      "Add photos and videos": "Tambahkan foto dan video",
      "Everyone with this link sees them": "Semua yang punya tautan ini bisa melihatnya",
      "Everyone with this link sees them. Up to {size} each.": "Semua yang punya tautan ini bisa melihatnya. Hingga {size} per file.",
      "Save all": "Simpan semua",
      "Show QR code": "Tampilkan kode QR",
      "Copy link": "Salin tautan",
      "Link copied": "Tautan disalin",
      "You made this album.": "Anda yang membuat album ini.",
      "Print poster": "Cetak poster",
      "Stop taking photos": "Berhenti menerima foto",
      "Take photos again": "Terima foto lagi",
      "Delete album": "Hapus album",
      "End-to-end encrypted: photos are encrypted on the device that adds them, and only people with this link can see them. The OmniBeam server can't.": "Terenkripsi end-to-end: foto dienkripsi di perangkat yang menambahkannya, dan hanya orang dengan tautan ini yang bisa melihatnya. Server OmniBeam tidak bisa.",
      "Make your own event album with OmniBeam: free, no app": "Buat album acara Anda sendiri dengan OmniBeam: gratis, tanpa aplikasi",
      "Scan to add your photos": "Pindai untuk menambahkan foto Anda",
      "No app needed: point your phone's camera at the code.": "Tanpa aplikasi: arahkan kamera ponsel ke kode.",
      "Previous": "Sebelumnya",
      "Next": "Berikutnya",
      "Save": "Simpan",
      "Delete": "Hapus",
      "Close": "Tutup",
      "This link is incomplete. Copy the whole link, including the part after #.": "Tautan ini tidak lengkap. Salin seluruh tautan, termasuk bagian setelah #.",
      "Could not load this album. Check the connection and try again.": "Tidak dapat memuat album ini. Periksa koneksi lalu coba lagi.",
      "This album has ended or was deleted.": "Album ini sudah berakhir atau dihapus.",
      "1 photo": "1 foto",
      "{n} photos": "{n} foto",
      "No photos yet. Add the first ones!": "Belum ada foto. Tambahkan yang pertama!",
      "This album no longer takes new photos.": "Album ini tidak lagi menerima foto baru.",
      "Open until {date}": "Terbuka sampai {date}",
      "Photo": "Foto",
      "Photos": "Foto",
      "Added from this device": "Ditambahkan dari perangkat ini",
      "Added by {name}": "Ditambahkan oleh {name}",
      "Could not load this photo. Check the connection and try again.": "Tidak dapat memuat foto ini. Periksa koneksi lalu coba lagi.",
      "Delete this photo for everyone?": "Hapus foto ini untuk semua orang?",
      "Could not delete it. Try again.": "Tidak dapat menghapus. Coba lagi.",
      "Getting photos… {pct}%": "Mengambil foto… {pct}%",
      "Save photos {a}–{b}": "Simpan foto {a}–{b}",
      "{file} is too large: up to {size} each.": "{file} terlalu besar: maksimal {size} per file.",
      "Could not add {file}. Check the connection and try again.": "Tidak dapat menambahkan {file}. Periksa koneksi lalu coba lagi.",
      "This album is full.": "Album ini sudah penuh.",
      "Too many photos at once. Try again in a few minutes.": "Terlalu banyak foto sekaligus. Coba lagi beberapa menit lagi.",
      "1 photo added ✓": "1 foto ditambahkan ✓",
      "{n} photos added ✓": "{n} foto ditambahkan ✓",
      "Adding {i} of {n}…": "Menambahkan {i} dari {n}…",
      "Could not change it. Try again.": "Tidak dapat mengubah. Coba lagi.",
      "Delete this album and all its photos for everyone?": "Hapus album ini dan semua fotonya untuk semua orang?",
      "Album deleted": "Album dihapus",
      "The host stopped taking new photos. You can still see and save the ones in the album.": "Pemilik album berhenti menerima foto baru. Anda masih bisa melihat dan menyimpan foto di album."
    },
    "it": {
      "Event album": "Album dell'evento",
      "Loading…": "Caricamento…",
      "Open OmniBeam": "Apri OmniBeam",
      "Your name (optional)": "Il tuo nome (facoltativo)",
      "Add photos and videos": "Aggiungi foto e video",
      "Everyone with this link sees them": "Tutti quelli con questo link le vedono",
      "Everyone with this link sees them. Up to {size} each.": "Tutti quelli con questo link le vedono. Fino a {size} ciascuna.",
      "Save all": "Salva tutto",
      "Show QR code": "Mostra codice QR",
      "Copy link": "Copia link",
      "Link copied": "Link copiato",
      "You made this album.": "Hai creato tu questo album.",
      "Print poster": "Stampa poster",
      "Stop taking photos": "Non accettare più foto",
      "Take photos again": "Accetta di nuovo foto",
      "Delete album": "Elimina album",
      "End-to-end encrypted: photos are encrypted on the device that adds them, and only people with this link can see them. The OmniBeam server can't.": "Crittografia end-to-end: le foto sono cifrate sul dispositivo che le aggiunge e solo chi ha questo link può vederle. Il server di OmniBeam no.",
      "Make your own event album with OmniBeam: free, no app": "Crea il tuo album dell'evento con OmniBeam: gratis, senza app",
      "Scan to add your photos": "Scansiona per aggiungere le tue foto",
      "No app needed: point your phone's camera at the code.": "Nessuna app necessaria: inquadra il codice con la fotocamera del telefono.",
      "Previous": "Precedente",
      "Next": "Successivo",
      "Save": "Salva",
      "Delete": "Elimina",
      "Close": "Chiudi",
      "This link is incomplete. Copy the whole link, including the part after #.": "Questo link è incompleto. Copia tutto il link, compresa la parte dopo #.",
      "Could not load this album. Check the connection and try again.": "Impossibile caricare l'album. Controlla la connessione e riprova.",
      "This album has ended or was deleted.": "Questo album è scaduto o è stato eliminato.",
      "1 photo": "1 foto",
      "{n} photos": "{n} foto",
      "No photos yet. Add the first ones!": "Ancora nessuna foto. Aggiungi le prime!",
      "This album no longer takes new photos.": "Questo album non accetta più nuove foto.",
      "Open until {date}": "Aperto fino al {date}",
      "Photo": "Foto",
      "Photos": "Foto",
      "Added from this device": "Aggiunta da questo dispositivo",
      "Added by {name}": "Aggiunta da {name}",
      "Could not load this photo. Check the connection and try again.": "Impossibile caricare la foto. Controlla la connessione e riprova.",
      "Delete this photo for everyone?": "Eliminare questa foto per tutti?",
      "Could not delete it. Try again.": "Impossibile eliminare. Riprova.",
      "Getting photos… {pct}%": "Recupero le foto… {pct}%",
      "Save photos {a}–{b}": "Salva le foto {a}–{b}",
      "{file} is too large: up to {size} each.": "{file} è troppo grande: fino a {size} ciascuno.",
      "Could not add {file}. Check the connection and try again.": "Impossibile aggiungere {file}. Controlla la connessione e riprova.",
      "This album is full.": "Questo album è pieno.",
      "Too many photos at once. Try again in a few minutes.": "Troppe foto insieme. Riprova tra qualche minuto.",
      "1 photo added ✓": "1 foto aggiunta ✓",
      "{n} photos added ✓": "{n} foto aggiunte ✓",
      "Adding {i} of {n}…": "Aggiungo {i} di {n}…",
      "Could not change it. Try again.": "Impossibile modificare. Riprova.",
      "Delete this album and all its photos for everyone?": "Eliminare questo album e tutte le sue foto per tutti?",
      "Album deleted": "Album eliminato",
      "The host stopped taking new photos. You can still see and save the ones in the album.": "L'organizzatore non accetta più nuove foto. Puoi ancora vedere e salvare quelle nell'album."
    },
    "ja": {
      "Event album": "イベントアルバム",
      "Loading…": "読み込み中…",
      "Open OmniBeam": "OmniBeam を開く",
      "Your name (optional)": "お名前（任意）",
      "Add photos and videos": "写真と動画を追加",
      "Everyone with this link sees them": "このリンクを持つ全員が見られます",
      "Everyone with this link sees them. Up to {size} each.": "このリンクを持つ全員が見られます。1 つ {size} まで。",
      "Save all": "すべて保存",
      "Show QR code": "QR コードを表示",
      "Copy link": "リンクをコピー",
      "Link copied": "リンクをコピーしました",
      "You made this album.": "このアルバムはあなたが作成しました。",
      "Print poster": "ポスターを印刷",
      "Stop taking photos": "写真の受付を止める",
      "Take photos again": "写真の受付を再開",
      "Delete album": "アルバムを削除",
      "End-to-end encrypted: photos are encrypted on the device that adds them, and only people with this link can see them. The OmniBeam server can't.": "エンドツーエンド暗号化：写真は追加したデバイス上で暗号化され、このリンクを持つ人だけが見られます。OmniBeam のサーバーには見えません。",
      "Make your own event album with OmniBeam: free, no app": "OmniBeam で自分のイベントアルバムを作ろう：無料、アプリ不要",
      "Scan to add your photos": "読み取って写真を追加",
      "No app needed: point your phone's camera at the code.": "アプリ不要：スマホのカメラをコードに向けてください。",
      "Previous": "前へ",
      "Next": "次へ",
      "Save": "保存",
      "Delete": "削除",
      "Close": "閉じる",
      "This link is incomplete. Copy the whole link, including the part after #.": "このリンクは不完全です。# 以降も含めてリンク全体をコピーしてください。",
      "Could not load this album. Check the connection and try again.": "アルバムを読み込めませんでした。接続を確認してもう一度お試しください。",
      "This album has ended or was deleted.": "このアルバムは終了したか、削除されました。",
      "1 photo": "写真 1 枚",
      "{n} photos": "写真 {n} 枚",
      "No photos yet. Add the first ones!": "まだ写真はありません。最初の 1 枚を追加しましょう！",
      "This album no longer takes new photos.": "このアルバムは新しい写真を受け付けていません。",
      "Open until {date}": "{date} まで公開",
      "Photo": "写真",
      "Photos": "写真",
      "Added from this device": "このデバイスから追加",
      "Added by {name}": "{name} が追加",
      "Could not load this photo. Check the connection and try again.": "写真を読み込めませんでした。接続を確認してもう一度お試しください。",
      "Delete this photo for everyone?": "この写真を全員に対して削除しますか？",
      "Could not delete it. Try again.": "削除できませんでした。もう一度お試しください。",
      "Getting photos… {pct}%": "写真を取得中… {pct}%",
      "Save photos {a}–{b}": "写真 {a}〜{b} を保存",
      "{file} is too large: up to {size} each.": "{file} は大きすぎます：1 つ {size} まで。",
      "Could not add {file}. Check the connection and try again.": "{file} を追加できませんでした。接続を確認してもう一度お試しください。",
      "This album is full.": "このアルバムはいっぱいです。",
      "Too many photos at once. Try again in a few minutes.": "一度に写真が多すぎます。数分後にもう一度お試しください。",
      "1 photo added ✓": "写真を 1 枚追加しました ✓",
      "{n} photos added ✓": "写真を {n} 枚追加しました ✓",
      "Adding {i} of {n}…": "{n} 枚中 {i} 枚目を追加中…",
      "Could not change it. Try again.": "変更できませんでした。もう一度お試しください。",
      "Delete this album and all its photos for everyone?": "このアルバムとすべての写真を全員に対して削除しますか？",
      "Album deleted": "アルバムを削除しました",
      "The host stopped taking new photos. You can still see and save the ones in the album.": "主催者が新しい写真の受付を止めました。アルバムの写真は引き続き見たり保存したりできます。"
    },
    "ko": {
      "Event album": "이벤트 앨범",
      "Loading…": "불러오는 중…",
      "Open OmniBeam": "OmniBeam 열기",
      "Your name (optional)": "이름 (선택)",
      "Add photos and videos": "사진과 동영상 추가",
      "Everyone with this link sees them": "이 링크가 있는 모두가 볼 수 있습니다",
      "Everyone with this link sees them. Up to {size} each.": "이 링크가 있는 모두가 볼 수 있습니다. 파일당 최대 {size}.",
      "Save all": "모두 저장",
      "Show QR code": "QR 코드 보기",
      "Copy link": "링크 복사",
      "Link copied": "링크를 복사했습니다",
      "You made this album.": "내가 만든 앨범입니다.",
      "Print poster": "포스터 인쇄",
      "Stop taking photos": "사진 받기 중지",
      "Take photos again": "사진 다시 받기",
      "Delete album": "앨범 삭제",
      "End-to-end encrypted: photos are encrypted on the device that adds them, and only people with this link can see them. The OmniBeam server can't.": "종단 간 암호화: 사진은 올리는 기기에서 암호화되며 이 링크가 있는 사람만 볼 수 있습니다. OmniBeam 서버는 볼 수 없습니다.",
      "Make your own event album with OmniBeam: free, no app": "OmniBeam으로 나만의 이벤트 앨범 만들기: 무료, 앱 불필요",
      "Scan to add your photos": "스캔해서 사진 올리기",
      "No app needed: point your phone's camera at the code.": "앱은 필요 없습니다. 휴대폰 카메라로 코드를 비추세요.",
      "Previous": "이전",
      "Next": "다음",
      "Save": "저장",
      "Delete": "삭제",
      "Close": "닫기",
      "This link is incomplete. Copy the whole link, including the part after #.": "링크가 완전하지 않습니다. # 뒷부분까지 링크 전체를 복사하세요.",
      "Could not load this album. Check the connection and try again.": "앨범을 불러올 수 없습니다. 연결을 확인하고 다시 시도하세요.",
      "This album has ended or was deleted.": "이 앨범은 끝났거나 삭제되었습니다.",
      "1 photo": "사진 1장",
      "{n} photos": "사진 {n}장",
      "No photos yet. Add the first ones!": "아직 사진이 없습니다. 첫 사진을 올려 보세요!",
      "This album no longer takes new photos.": "이 앨범은 더 이상 새 사진을 받지 않습니다.",
      "Open until {date}": "{date}까지 열림",
      "Photo": "사진",
      "Photos": "사진",
      "Added from this device": "이 기기에서 올림",
      "Added by {name}": "{name} 님이 올림",
      "Could not load this photo. Check the connection and try again.": "사진을 불러올 수 없습니다. 연결을 확인하고 다시 시도하세요.",
      "Delete this photo for everyone?": "이 사진을 모두에게서 삭제할까요?",
      "Could not delete it. Try again.": "삭제할 수 없습니다. 다시 시도하세요.",
      "Getting photos… {pct}%": "사진 가져오는 중… {pct}%",
      "Save photos {a}–{b}": "사진 {a}–{b} 저장",
      "{file} is too large: up to {size} each.": "{file}이(가) 너무 큽니다. 파일당 최대 {size}.",
      "Could not add {file}. Check the connection and try again.": "{file}을(를) 올릴 수 없습니다. 연결을 확인하고 다시 시도하세요.",
      "This album is full.": "이 앨범은 가득 찼습니다.",
      "Too many photos at once. Try again in a few minutes.": "한 번에 사진이 너무 많습니다. 몇 분 뒤에 다시 시도하세요.",
      "1 photo added ✓": "사진 1장을 올렸습니다 ✓",
      "{n} photos added ✓": "사진 {n}장을 올렸습니다 ✓",
      "Adding {i} of {n}…": "{n}개 중 {i}번째 올리는 중…",
      "Could not change it. Try again.": "변경할 수 없습니다. 다시 시도하세요.",
      "Delete this album and all its photos for everyone?": "이 앨범과 모든 사진을 모두에게서 삭제할까요?",
      "Album deleted": "앨범을 삭제했습니다",
      "The host stopped taking new photos. You can still see and save the ones in the album.": "앨범 주인이 새 사진 받기를 중지했습니다. 앨범의 사진은 계속 보고 저장할 수 있습니다."
    },
    "pt": {
      "Event album": "Álbum do evento",
      "Loading…": "Carregando…",
      "Open OmniBeam": "Abrir o OmniBeam",
      "Your name (optional)": "Seu nome (opcional)",
      "Add photos and videos": "Adicionar fotos e vídeos",
      "Everyone with this link sees them": "Todos com este link podem vê-las",
      "Everyone with this link sees them. Up to {size} each.": "Todos com este link podem vê-las. Até {size} cada.",
      "Save all": "Salvar tudo",
      "Show QR code": "Mostrar código QR",
      "Copy link": "Copiar link",
      "Link copied": "Link copiado",
      "You made this album.": "Você criou este álbum.",
      "Print poster": "Imprimir cartaz",
      "Stop taking photos": "Parar de receber fotos",
      "Take photos again": "Receber fotos de novo",
      "Delete album": "Excluir álbum",
      "End-to-end encrypted: photos are encrypted on the device that adds them, and only people with this link can see them. The OmniBeam server can't.": "Criptografia de ponta a ponta: as fotos são criptografadas no dispositivo que as adiciona, e só quem tem este link pode vê-las. O servidor do OmniBeam não pode.",
      "Make your own event album with OmniBeam: free, no app": "Crie seu próprio álbum de evento com o OmniBeam: grátis, sem app",
      "Scan to add your photos": "Escaneie para adicionar suas fotos",
      "No app needed: point your phone's camera at the code.": "Não precisa de app: aponte a câmera do celular para o código.",
      "Previous": "Anterior",
      "Next": "Próximo",
      "Save": "Salvar",
      "Delete": "Excluir",
      "Close": "Fechar",
      "This link is incomplete. Copy the whole link, including the part after #.": "Este link está incompleto. Copie o link inteiro, incluindo a parte depois de #.",
      "Could not load this album. Check the connection and try again.": "Não foi possível carregar o álbum. Verifique a conexão e tente de novo.",
      "This album has ended or was deleted.": "Este álbum terminou ou foi excluído.",
      "1 photo": "1 foto",
      "{n} photos": "{n} fotos",
      "No photos yet. Add the first ones!": "Ainda não há fotos. Adicione as primeiras!",
      "This album no longer takes new photos.": "Este álbum não aceita mais fotos novas.",
      "Open until {date}": "Aberto até {date}",
      "Photo": "Foto",
      "Photos": "Fotos",
      "Added from this device": "Adicionada deste dispositivo",
      "Added by {name}": "Adicionada por {name}",
      "Could not load this photo. Check the connection and try again.": "Não foi possível carregar a foto. Verifique a conexão e tente de novo.",
      "Delete this photo for everyone?": "Excluir esta foto para todos?",
      "Could not delete it. Try again.": "Não foi possível excluir. Tente de novo.",
      "Getting photos… {pct}%": "Obtendo fotos… {pct}%",
      "Save photos {a}–{b}": "Salvar fotos {a}–{b}",
      "{file} is too large: up to {size} each.": "{file} é grande demais: até {size} cada.",
      "Could not add {file}. Check the connection and try again.": "Não foi possível adicionar {file}. Verifique a conexão e tente de novo.",
      "This album is full.": "Este álbum está cheio.",
      "Too many photos at once. Try again in a few minutes.": "Fotos demais de uma vez. Tente de novo em alguns minutos.",
      "1 photo added ✓": "1 foto adicionada ✓",
      "{n} photos added ✓": "{n} fotos adicionadas ✓",
      "Adding {i} of {n}…": "Adicionando {i} de {n}…",
      "Could not change it. Try again.": "Não foi possível mudar. Tente de novo.",
      "Delete this album and all its photos for everyone?": "Excluir este álbum e todas as fotos para todos?",
      "Album deleted": "Álbum excluído",
      "The host stopped taking new photos. You can still see and save the ones in the album.": "O anfitrião parou de receber fotos novas. Você ainda pode ver e salvar as do álbum."
    },
    "ru": {
      "Event album": "Альбом события",
      "Loading…": "Загрузка…",
      "Open OmniBeam": "Открыть OmniBeam",
      "Your name (optional)": "Ваше имя (необязательно)",
      "Add photos and videos": "Добавить фото и видео",
      "Everyone with this link sees them": "Их видят все, у кого есть эта ссылка",
      "Everyone with this link sees them. Up to {size} each.": "Их видят все, у кого есть эта ссылка. До {size} каждое.",
      "Save all": "Сохранить все",
      "Show QR code": "Показать QR-код",
      "Copy link": "Копировать ссылку",
      "Link copied": "Ссылка скопирована",
      "You made this album.": "Вы создали этот альбом.",
      "Print poster": "Распечатать плакат",
      "Stop taking photos": "Не принимать новые фото",
      "Take photos again": "Снова принимать фото",
      "Delete album": "Удалить альбом",
      "End-to-end encrypted: photos are encrypted on the device that adds them, and only people with this link can see them. The OmniBeam server can't.": "Сквозное шифрование: фото шифруются на устройстве, которое их добавляет, и видеть их могут только те, у кого есть эта ссылка. Сервер OmniBeam — нет.",
      "Make your own event album with OmniBeam: free, no app": "Создайте свой альбом события в OmniBeam: бесплатно, без приложения",
      "Scan to add your photos": "Отсканируйте, чтобы добавить фото",
      "No app needed: point your phone's camera at the code.": "Приложение не нужно: наведите камеру телефона на код.",
      "Previous": "Назад",
      "Next": "Далее",
      "Save": "Сохранить",
      "Delete": "Удалить",
      "Close": "Закрыть",
      "This link is incomplete. Copy the whole link, including the part after #.": "Ссылка неполная. Скопируйте её целиком, включая часть после #.",
      "Could not load this album. Check the connection and try again.": "Не удалось загрузить альбом. Проверьте подключение и попробуйте ещё раз.",
      "This album has ended or was deleted.": "Этот альбом закрыт или удалён.",
      "1 photo": "1 фото",
      "{n} photos": "Фото: {n}",
      "No photos yet. Add the first ones!": "Фото пока нет. Добавьте первые!",
      "This album no longer takes new photos.": "Этот альбом больше не принимает новые фото.",
      "Open until {date}": "Открыт до {date}",
      "Photo": "Фото",
      "Photos": "Фото",
      "Added from this device": "Добавлено с этого устройства",
      "Added by {name}": "Добавил(а) {name}",
      "Could not load this photo. Check the connection and try again.": "Не удалось загрузить фото. Проверьте подключение и попробуйте ещё раз.",
      "Delete this photo for everyone?": "Удалить это фото для всех?",
      "Could not delete it. Try again.": "Не удалось удалить. Попробуйте ещё раз.",
      "Getting photos… {pct}%": "Получение фото… {pct}%",
      "Save photos {a}–{b}": "Сохранить фото {a}–{b}",
      "{file} is too large: up to {size} each.": "{file} слишком большой: не более {size} каждый.",
      "Could not add {file}. Check the connection and try again.": "Не удалось добавить {file}. Проверьте подключение и попробуйте ещё раз.",
      "This album is full.": "Этот альбом заполнен.",
      "Too many photos at once. Try again in a few minutes.": "Слишком много фото сразу. Попробуйте через несколько минут.",
      "1 photo added ✓": "Добавлено 1 фото ✓",
      "{n} photos added ✓": "Добавлено фото: {n} ✓",
      "Adding {i} of {n}…": "Добавление {i} из {n}…",
      "Could not change it. Try again.": "Не удалось изменить. Попробуйте ещё раз.",
      "Delete this album and all its photos for everyone?": "Удалить этот альбом и все его фото для всех?",
      "Album deleted": "Альбом удалён",
      "The host stopped taking new photos. You can still see and save the ones in the album.": "Организатор больше не принимает новые фото. Фото в альбоме по-прежнему можно смотреть и сохранять."
    },
    "tr": {
      "Event album": "Etkinlik albümü",
      "Loading…": "Yükleniyor…",
      "Open OmniBeam": "OmniBeam'i aç",
      "Your name (optional)": "Adın (isteğe bağlı)",
      "Add photos and videos": "Fotoğraf ve video ekle",
      "Everyone with this link sees them": "Bu bağlantıya sahip herkes görür",
      "Everyone with this link sees them. Up to {size} each.": "Bu bağlantıya sahip herkes görür. Her biri en fazla {size}.",
      "Save all": "Tümünü kaydet",
      "Show QR code": "QR kodu göster",
      "Copy link": "Bağlantıyı kopyala",
      "Link copied": "Bağlantı kopyalandı",
      "You made this album.": "Bu albümü sen oluşturdun.",
      "Print poster": "Poster yazdır",
      "Stop taking photos": "Fotoğraf almayı durdur",
      "Take photos again": "Yeniden fotoğraf al",
      "Delete album": "Albümü sil",
      "End-to-end encrypted: photos are encrypted on the device that adds them, and only people with this link can see them. The OmniBeam server can't.": "Uçtan uca şifreli: fotoğraflar ekleyen cihazda şifrelenir ve yalnızca bu bağlantıya sahip kişiler görebilir. OmniBeam sunucusu göremez.",
      "Make your own event album with OmniBeam: free, no app": "OmniBeam ile kendi etkinlik albümünü oluştur: ücretsiz, uygulamasız",
      "Scan to add your photos": "Fotoğraflarını eklemek için tara",
      "No app needed: point your phone's camera at the code.": "Uygulama gerekmez: telefonunun kamerasını koda tut.",
      "Previous": "Önceki",
      "Next": "Sonraki",
      "Save": "Kaydet",
      "Delete": "Sil",
      "Close": "Kapat",
      "This link is incomplete. Copy the whole link, including the part after #.": "Bu bağlantı eksik. # işaretinden sonraki kısım dahil bağlantının tamamını kopyala.",
      "Could not load this album. Check the connection and try again.": "Albüm yüklenemedi. Bağlantıyı kontrol edip tekrar dene.",
      "This album has ended or was deleted.": "Bu albüm sona erdi ya da silindi.",
      "1 photo": "1 fotoğraf",
      "{n} photos": "{n} fotoğraf",
      "No photos yet. Add the first ones!": "Henüz fotoğraf yok. İlklerini sen ekle!",
      "This album no longer takes new photos.": "Bu albüm artık yeni fotoğraf almıyor.",
      "Open until {date}": "{date} tarihine kadar açık",
      "Photo": "Fotoğraf",
      "Photos": "Fotoğraflar",
      "Added from this device": "Bu cihazdan eklendi",
      "Added by {name}": "{name} ekledi",
      "Could not load this photo. Check the connection and try again.": "Fotoğraf yüklenemedi. Bağlantıyı kontrol edip tekrar dene.",
      "Delete this photo for everyone?": "Bu fotoğraf herkes için silinsin mi?",
      "Could not delete it. Try again.": "Silinemedi. Tekrar dene.",
      "Getting photos… {pct}%": "Fotoğraflar alınıyor… %{pct}",
      "Save photos {a}–{b}": "{a}–{b} arası fotoğrafları kaydet",
      "{file} is too large: up to {size} each.": "{file} çok büyük: her biri en fazla {size}.",
      "Could not add {file}. Check the connection and try again.": "{file} eklenemedi. Bağlantıyı kontrol edip tekrar dene.",
      "This album is full.": "Bu albüm dolu.",
      "Too many photos at once. Try again in a few minutes.": "Aynı anda çok fazla fotoğraf. Birkaç dakika sonra tekrar dene.",
      "1 photo added ✓": "1 fotoğraf eklendi ✓",
      "{n} photos added ✓": "{n} fotoğraf eklendi ✓",
      "Adding {i} of {n}…": "{n} içinden {i}. ekleniyor…",
      "Could not change it. Try again.": "Değiştirilemedi. Tekrar dene.",
      "Delete this album and all its photos for everyone?": "Bu albüm ve tüm fotoğrafları herkes için silinsin mi?",
      "Album deleted": "Albüm silindi",
      "The host stopped taking new photos. You can still see and save the ones in the album.": "Albüm sahibi yeni fotoğraf almayı durdurdu. Albümdekileri yine de görebilir ve kaydedebilirsin."
    },
    "ur": {
      "Event album": "تقریب کا البم",
      "Loading…": "لوڈ ہو رہا ہے…",
      "Open OmniBeam": "OmniBeam کھولیں",
      "Your name (optional)": "آپ کا نام (اختیاری)",
      "Add photos and videos": "تصویریں اور ویڈیوز شامل کریں",
      "Everyone with this link sees them": "اس لنک والے سب انہیں دیکھتے ہیں",
      "Everyone with this link sees them. Up to {size} each.": "اس لنک والے سب انہیں دیکھتے ہیں۔ ہر ایک {size} تک۔",
      "Save all": "سب محفوظ کریں",
      "Show QR code": "QR کوڈ دکھائیں",
      "Copy link": "لنک کاپی کریں",
      "Link copied": "لنک کاپی ہو گیا",
      "You made this album.": "یہ البم آپ نے بنایا ہے۔",
      "Print poster": "پوسٹر پرنٹ کریں",
      "Stop taking photos": "تصویریں لینا بند کریں",
      "Take photos again": "دوبارہ تصویریں لیں",
      "Delete album": "البم حذف کریں",
      "End-to-end encrypted: photos are encrypted on the device that adds them, and only people with this link can see them. The OmniBeam server can't.": "اینڈ ٹو اینڈ انکرپٹڈ: تصویریں شامل کرنے والے ڈیوائس پر ہی انکرپٹ ہوتی ہیں، اور صرف اس لنک والے لوگ انہیں دیکھ سکتے ہیں۔ OmniBeam سرور نہیں دیکھ سکتا۔",
      "Make your own event album with OmniBeam: free, no app": "OmniBeam کے ساتھ اپنا تقریب کا البم بنائیں: مفت، بغیر ایپ",
      "Scan to add your photos": "اپنی تصویریں شامل کرنے کے لیے اسکین کریں",
      "No app needed: point your phone's camera at the code.": "ایپ کی ضرورت نہیں: فون کا کیمرہ کوڈ کی طرف کریں۔",
      "Previous": "پچھلا",
      "Next": "اگلا",
      "Save": "محفوظ کریں",
      "Delete": "حذف کریں",
      "Close": "بند کریں",
      "This link is incomplete. Copy the whole link, including the part after #.": "یہ لنک نامکمل ہے۔ پورا لنک کاپی کریں، # کے بعد والا حصہ بھی۔",
      "Could not load this album. Check the connection and try again.": "یہ البم لوڈ نہیں ہو سکا۔ کنکشن چیک کر کے دوبارہ کوشش کریں۔",
      "This album has ended or was deleted.": "یہ البم ختم ہو گیا ہے یا حذف کر دیا گیا ہے۔",
      "1 photo": "1 تصویر",
      "{n} photos": "{n} تصویریں",
      "No photos yet. Add the first ones!": "ابھی کوئی تصویر نہیں۔ پہلی تصویریں شامل کریں!",
      "This album no longer takes new photos.": "یہ البم اب نئی تصویریں نہیں لیتا۔",
      "Open until {date}": "{date} تک کھلا",
      "Photo": "تصویر",
      "Photos": "تصویریں",
      "Added from this device": "اس ڈیوائس سے شامل کی گئی",
      "Added by {name}": "{name} نے شامل کی",
      "Could not load this photo. Check the connection and try again.": "یہ تصویر لوڈ نہیں ہو سکی۔ کنکشن چیک کر کے دوبارہ کوشش کریں۔",
      "Delete this photo for everyone?": "یہ تصویر سب کے لیے حذف کریں؟",
      "Could not delete it. Try again.": "حذف نہیں ہو سکا۔ دوبارہ کوشش کریں۔",
      "Getting photos… {pct}%": "تصویریں لا رہے ہیں… {pct}%",
      "Save photos {a}–{b}": "تصویریں {a}–{b} محفوظ کریں",
      "{file} is too large: up to {size} each.": "{file} بہت بڑی ہے: ہر ایک {size} تک۔",
      "Could not add {file}. Check the connection and try again.": "{file} شامل نہیں ہو سکی۔ کنکشن چیک کر کے دوبارہ کوشش کریں۔",
      "This album is full.": "یہ البم بھر گیا ہے۔",
      "Too many photos at once. Try again in a few minutes.": "ایک ساتھ بہت زیادہ تصویریں۔ چند منٹ بعد دوبارہ کوشش کریں۔",
      "1 photo added ✓": "1 تصویر شامل ہو گئی ✓",
      "{n} photos added ✓": "{n} تصویریں شامل ہو گئیں ✓",
      "Adding {i} of {n}…": "{n} میں سے {i} شامل ہو رہی ہے…",
      "Could not change it. Try again.": "تبدیل نہیں ہو سکا۔ دوبارہ کوشش کریں۔",
      "Delete this album and all its photos for everyone?": "یہ البم اور اس کی سب تصویریں سب کے لیے حذف کریں؟",
      "Album deleted": "البم حذف ہو گیا",
      "The host stopped taking new photos. You can still see and save the ones in the album.": "میزبان نے نئی تصویریں لینا بند کر دیا ہے۔ آپ البم کی تصویریں اب بھی دیکھ اور محفوظ کر سکتے ہیں۔"
    },
    "zh": {
      "Event album": "活动相册",
      "Loading…": "正在加载…",
      "Open OmniBeam": "打开 OmniBeam",
      "Your name (optional)": "你的名字（可选）",
      "Add photos and videos": "添加照片和视频",
      "Everyone with this link sees them": "拥有此链接的人都能看到",
      "Everyone with this link sees them. Up to {size} each.": "拥有此链接的人都能看到。每个不超过 {size}。",
      "Save all": "全部保存",
      "Show QR code": "显示二维码",
      "Copy link": "复制链接",
      "Link copied": "链接已复制",
      "You made this album.": "这个相册是你创建的。",
      "Print poster": "打印海报",
      "Stop taking photos": "停止接收照片",
      "Take photos again": "重新接收照片",
      "Delete album": "删除相册",
      "End-to-end encrypted: photos are encrypted on the device that adds them, and only people with this link can see them. The OmniBeam server can't.": "端到端加密：照片在添加它们的设备上加密，只有拥有此链接的人才能查看。OmniBeam 服务器无法查看。",
      "Make your own event album with OmniBeam: free, no app": "用 OmniBeam 创建你自己的活动相册：免费，无需应用",
      "Scan to add your photos": "扫码添加你的照片",
      "No app needed: point your phone's camera at the code.": "无需应用：用手机相机对准二维码即可。",
      "Previous": "上一张",
      "Next": "下一张",
      "Save": "保存",
      "Delete": "删除",
      "Close": "关闭",
      "This link is incomplete. Copy the whole link, including the part after #.": "此链接不完整。请复制完整链接，包括 # 后面的部分。",
      "Could not load this album. Check the connection and try again.": "无法加载此相册。请检查网络后重试。",
      "This album has ended or was deleted.": "此相册已结束或已被删除。",
      "1 photo": "1 张照片",
      "{n} photos": "{n} 张照片",
      "No photos yet. Add the first ones!": "还没有照片。来添加第一张吧！",
      "This album no longer takes new photos.": "此相册不再接收新照片。",
      "Open until {date}": "开放至 {date}",
      "Photo": "照片",
      "Photos": "照片",
      "Added from this device": "从此设备添加",
      "Added by {name}": "由 {name} 添加",
      "Could not load this photo. Check the connection and try again.": "无法加载此照片。请检查网络后重试。",
      "Delete this photo for everyone?": "要为所有人删除这张照片吗？",
      "Could not delete it. Try again.": "无法删除。请重试。",
      "Getting photos… {pct}%": "正在获取照片… {pct}%",
      "Save photos {a}–{b}": "保存第 {a}–{b} 张照片",
      "{file} is too large: up to {size} each.": "{file} 太大：每个不超过 {size}。",
      "Could not add {file}. Check the connection and try again.": "无法添加 {file}。请检查网络后重试。",
      "This album is full.": "此相册已满。",
      "Too many photos at once. Try again in a few minutes.": "同时上传的照片太多。请几分钟后再试。",
      "1 photo added ✓": "已添加 1 张照片 ✓",
      "{n} photos added ✓": "已添加 {n} 张照片 ✓",
      "Adding {i} of {n}…": "正在添加第 {i} 张，共 {n} 张…",
      "Could not change it. Try again.": "无法更改。请重试。",
      "Delete this album and all its photos for everyone?": "要为所有人删除此相册及其所有照片吗？",
      "Album deleted": "相册已删除",
      "The host stopped taking new photos. You can still see and save the ones in the album.": "主办人已停止接收新照片。你仍可以查看并保存相册中的照片。"
    }
  };
  let lang = 'en';
  try { lang = localStorage.getItem('omnibeam-lang') || ''; } catch {}
  if (!TEXT[lang] && lang !== 'en') lang = (navigator.languages || [navigator.language || 'en']).map((l) => String(l).slice(0, 2).toLowerCase()).find((l) => TEXT[l]) || 'en';
  const t = (s, vars) => {
    let out = (TEXT[lang] && TEXT[lang][s]) || s;
    for (const [k, v] of Object.entries(vars || {})) out = out.split(`{${k}}`).join(v);
    return out;
  };
  if (lang !== 'en') {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' || lang === 'ur' ? 'rtl' : 'ltr';
    for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
    for (const a of document.querySelectorAll('a[href="/"]')) a.href = `/${lang}/`;
  }
  document.title = `${t('Event album')} | OmniBeam`;
  document.querySelector('#ev-grid').setAttribute('aria-label', t('Photos'));
  document.querySelector('#ev-view').setAttribute('aria-label', t('Photo'));

  const $ = (s) => document.querySelector(s);
  const status = (text) => { $('#ev-status').textContent = text; };
  const formatSize = (n) => {
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
  };
  const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const b64u = (buf) => {
    let s = '';
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  async function encrypt(key, data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    const out = new Uint8Array(12 + ct.byteLength);
    out.set(iv);
    out.set(new Uint8Array(ct), 12);
    return out;
  }
  async function decrypt(key, buf) {
    const all = new Uint8Array(buf);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, key, all.subarray(12));
  }
  const seal = async (key, obj) => b64u(await encrypt(key, new TextEncoder().encode(JSON.stringify(obj))));
  const open = async (key, text) => JSON.parse(new TextDecoder().decode(await decrypt(key, fromB64u(text))));

  const id = (location.pathname.match(/^\/e\/([A-Za-z0-9_-]{8,40})$/) || [])[1];
  const [keyText, hostToken = ''] = location.hash.slice(1).split('.');
  const POSTER = new URLSearchParams(location.search).get('poster') === '1';
  const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const MINE_KEY = 'omnibeam-album-mine'; // { "<album id>": { "<n>": del token } }: photos this device added
  const loadMine = () => { try { return JSON.parse(localStorage.getItem(MINE_KEY) || '{}'); } catch { return {}; } };
  const saveMine = (all) => { try { localStorage.setItem(MINE_KEY, JSON.stringify(all)); } catch {} };
  const mine = () => loadMine()[id] || {};
  // The host's token: in the address (album.js opens it so), or saved by album.js on this device
  function hostTokenOf() {
    if (/^[0-9a-f]{32}$/.test(hostToken)) return hostToken;
    try { return (JSON.parse(localStorage.getItem('omnibeam-albums') || '[]').find((a) => a.id === id) || {}).token || ''; } catch { return ''; }
  }
  const TOKEN = hostTokenOf();
  const guestUrl = `${location.origin}/e/${id}#${keyText}`;
  if (hostToken) history.replaceState(null, '', `${location.pathname}${location.search}#${keyText}`); // so a copied address never has it

  let key = null;
  let album = null; // { name, q } from the encrypted box
  let info = null;  // the server's answer
  let version = ''; // the album's version in that answer (see refresh)
  const items = new Map(); // n -> { n, at, size, thumb, meta: {name, type, from}, thumbUrl, el }
  let order = [];   // n, newest first

  async function start() {
    if (!id || !/^[A-Za-z0-9_-]{22}$/.test(keyText || '') || !window.crypto?.subtle) {
      return status(t('This link is incomplete. Copy the whole link, including the part after #.'));
    }
    try {
      key = await crypto.subtle.importKey('raw', fromB64u(keyText), 'AES-GCM', false, ['encrypt', 'decrypt']);
    } catch { return status(t('This link is incomplete. Copy the whole link, including the part after #.')); }
    if (!(await refresh(true))) return;
    if (POSTER) return showPoster();
    try { $('#ev-from').value = localStorage.getItem('omnibeam-album-name') || ''; } catch {}
    $('#ev-from').addEventListener('change', (e) => { try { localStorage.setItem('omnibeam-album-name', e.target.value.trim()); } catch {} });
    // A quick look every 3 seconds (the server answers in a few bytes when nothing changed), so new and deleted
    // photos and a closed album show up on every open page almost at once
    setInterval(() => { if (document.visibilityState === 'visible' && !adding) refresh(false, true); }, 3000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !adding) refresh(); });
  }

  // Ask the server for the album and its photos; draw the new ones
  async function refresh(first = false, quick = false) {
    let res;
    try { res = await fetch(`/api/album/${id}${quick && version ? `?v=${version}` : ''}`, { cache: 'no-store', headers: TOKEN ? { 'X-Album-Token': TOKEN } : {} }); } catch {
      if (first) status(t('Could not load this album. Check the connection and try again.'));
      return false;
    }
    if (res.status === 404) {
      status(t('This album has ended or was deleted.'));
      $('#ev-add').hidden = $('#ev-tools').hidden = $('#ev-host').hidden = true;
      $('#ev-grid').innerHTML = '';
      return false;
    }
    if (!res.ok) { if (first) status(t('Could not load this album. Check the connection and try again.')); return false; }
    const got = await res.json();
    if (got.same) return true; // nothing new since the last look
    info = got;
    version = got.v || '';
    if (!album) {
      try { album = await open(key, info.meta); } catch { status(t('This link is incomplete. Copy the whole link, including the part after #.')); return false; }
      const name = String(album.name || '').slice(0, 80) || t('Event album');
      $('#ev-title').textContent = name;
      document.title = `${name} | OmniBeam`;
      $('#ev-poster-title').textContent = name;
    }
    const seen = new Set();
    for (const it of info.items) {
      seen.add(it.n);
      if (items.has(it.n)) continue;
      let meta = {};
      try { meta = await open(key, it.meta); } catch { continue; }
      items.set(it.n, { ...it, meta });
    }
    for (const n of [...items.keys()]) {
      if (seen.has(n)) continue;
      // Deleted by the guest who added it, or by the host: gone here too (and from the viewer if it's open)
      items.get(n).el?.remove();
      items.delete(n);
      if (viewing === n) $('#ev-view').close();
    }
    order = [...items.keys()].sort((a, b) => b - a);
    draw();
    return true;
  }

  function draw() {
    const host = !!info.host;
    $('#ev-host').hidden = !host;
    $('#ev-open').textContent = info.open ? t('Stop taking photos') : t('Take photos again');
    $('#ev-add').hidden = !info.open;
    // Guests see clearly that the album is closed (also when it closes while this page is open)
    $('#ev-closed').hidden = info.open || host;
    $('#ev-tools').hidden = false;
    $('#ev-save-all').hidden = !order.length;
    $('#ev-zone-small').textContent = t('Everyone with this link sees them. Up to {size} each.', { size: formatSize(info.itemMb * 1048576) });
    const n = order.length;
    const count = n === 1 ? t('1 photo') : t('{n} photos', { n });
    const ends = new Date(info.expires).toLocaleDateString(lang, { day: 'numeric', month: 'long' });
    if (!adding) {
      status(!n ? (info.open ? t('No photos yet. Add the first ones!') : t('This album no longer takes new photos.'))
        : `${count} · ${info.open ? t('Open until {date}', { date: ends }) : t('This album no longer takes new photos.')}`);
    }
    const grid = $('#ev-grid');
    const mineNow = mine();
    let prev = null;
    for (const num of order) {
      const it = items.get(num);
      if (!it.el) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        const label = `${it.meta.name || ''}${it.meta.from ? ' · ' + it.meta.from : ''}`;
        btn.setAttribute('aria-label', label || t('Photo'));
        btn.innerHTML = '<span class="ph"></span>';
        btn.querySelector('.ph').textContent = it.meta.name || '';
        btn.onclick = () => view(num);
        li.append(btn);
        if (/^video\//.test(it.meta.type || '')) li.insertAdjacentHTML('beforeend', '<span class="vid">▶</span>');
        it.el = li;
        thumbs.observe(li);
        li.dataset.n = num;
      }
      it.el.querySelector('.mine')?.remove();
      if (mineNow[num]) it.el.insertAdjacentHTML('beforeend', `<span class="mine" title="${t('Added from this device')}"></span>`);
      if (prev ? prev.nextSibling !== it.el : grid.firstChild !== it.el) {
        if (prev) prev.after(it.el); else grid.prepend(it.el);
      }
      prev = it.el;
    }
  }

  // ---- Small pictures for the grid, loaded when they come into view, 4 at a time ----
  const thumbQueue = [];
  let thumbsBusy = 0;
  const thumbs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      thumbs.unobserve(e.target);
      thumbQueue.push(Number(e.target.dataset.n));
    }
    pumpThumbs();
  }, { rootMargin: '300px' });
  function pumpThumbs() {
    while (thumbsBusy < 4 && thumbQueue.length) {
      const it = items.get(thumbQueue.shift());
      if (!it || !it.thumb) continue;
      thumbsBusy++;
      fetch(`/api/album/${id}/${it.n}/thumb`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((buf) => decrypt(key, buf))
        .then((plain) => {
          it.thumbUrl = URL.createObjectURL(new Blob([plain], { type: 'image/jpeg' }));
          const ph = it.el?.querySelector('.ph');
          if (ph) {
            const img = new Image();
            img.alt = '';
            img.src = it.thumbUrl;
            ph.replaceWith(img);
          }
        })
        .catch(() => {})
        .finally(() => { thumbsBusy--; pumpThumbs(); });
    }
  }

  // ---- The photo itself ----
  const full = new Map(); // n -> Promise<Blob>
  function fullBlob(it) {
    if (!full.has(it.n)) {
      const p = fetch(`/api/album/${id}/${it.n}/full`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((buf) => decrypt(key, buf))
        .then((plain) => new Blob([plain], { type: it.meta.type || 'application/octet-stream' }));
      p.catch(() => full.delete(it.n));
      full.set(it.n, p);
    }
    return full.get(it.n);
  }
  let viewing = null;
  async function view(n) {
    const it = items.get(n);
    if (!it) return;
    viewing = n;
    const dlg = $('#ev-view');
    const box = $('#ev-view-media');
    box.innerHTML = '';
    if (it.thumbUrl) box.innerHTML = `<img src="${it.thumbUrl}" alt="">`;
    $('#ev-view-who').textContent = [it.meta.from ? t('Added by {name}', { name: it.meta.from }) : '', it.meta.name || '', formatSize(it.meta.size || it.size)].filter(Boolean).join(' · ');
    dlg.querySelector('[data-act=delete]').hidden = !(info.host || mine()[n]);
    const i = order.indexOf(n);
    dlg.querySelector('[data-act=prev]').disabled = i <= 0;
    dlg.querySelector('[data-act=next]').disabled = i >= order.length - 1;
    if (!dlg.open) dlg.showModal();
    try {
      const blob = await fullBlob(it);
      if (viewing !== n) return;
      const url = URL.createObjectURL(blob);
      const el = document.createElement(/^video\//.test(blob.type) ? 'video' : 'img');
      el.src = url;
      if (el.tagName === 'VIDEO') { el.controls = true; el.playsInline = true; } else el.alt = it.meta.name || '';
      box.innerHTML = '';
      box.append(el);
    } catch {
      if (viewing === n) box.insertAdjacentHTML('beforeend', `<p>${t('Could not load this photo. Check the connection and try again.')}</p>`);
    }
  }
  $('#ev-view').addEventListener('click', async (e) => {
    const dlg = $('#ev-view');
    if (e.target === dlg) return dlg.close();
    const act = e.target.closest('[data-act]')?.dataset.act;
    const i = order.indexOf(viewing);
    if (act === 'close') dlg.close();
    else if (act === 'prev' && i > 0) view(order[i - 1]);
    else if (act === 'next' && i < order.length - 1) view(order[i + 1]);
    else if (act === 'save') saveOne(items.get(viewing));
    else if (act === 'delete') removeItem(items.get(viewing));
  });
  $('#ev-view').addEventListener('keydown', (e) => {
    const i = order.indexOf(viewing);
    const rtl = document.documentElement.dir === 'rtl';
    if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft') && i > 0) view(order[i - 1]);
    if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight') && i < order.length - 1) view(order[i + 1]);
  });
  $('#ev-view').addEventListener('close', () => { viewing = null; $('#ev-view-media').innerHTML = ''; });

  const fileName = (it) => String(it.meta.name || `photo-${it.n}.jpg`).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120);
  function download(blob, name) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  async function saveOne(it) {
    if (!it) return;
    try {
      const blob = await fullBlob(it);
      const file = new File([blob], fileName(it), { type: blob.type });
      // Phones: the share sheet has "Save image" / "Save to Photos"
      if (isPhone && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; } catch (err) { if (err.name === 'AbortError') return; }
      }
      download(blob, file.name);
    } catch { alert(t('Could not load this photo. Check the connection and try again.')); }
  }
  async function removeItem(it) {
    if (!it || !confirm(t('Delete this photo for everyone?'))) return;
    const headers = {};
    const del = mine()[it.n];
    if (del) headers['X-Album-Del'] = del;
    if (TOKEN) headers['X-Album-Token'] = TOKEN;
    try {
      const r = await fetch(`/api/album/${id}/${it.n}`, { method: 'DELETE', headers });
      if (!r.ok && r.status !== 404) throw new Error();
    } catch { return alert(t('Could not delete it. Try again.')); }
    $('#ev-view').close();
    it.el?.remove();
    items.delete(it.n);
    order = order.filter((x) => x !== it.n);
    draw();
  }

  // ---- Save all: photos to the share sheet 20 at a time on phones (Save to Photos), a ZIP elsewhere ----
  let saveFrom = 0;
  $('#ev-save-all').onclick = async () => {
    const btn = $('#ev-save-all');
    const list = order.slice().reverse().map((n) => items.get(n)).filter(Boolean); // oldest first
    if (!list.length) return;
    btn.disabled = true;
    const label = t('Save all');
    try {
      if (isPhone && navigator.canShare && list.length) {
        const batch = list.slice(saveFrom, saveFrom + 20);
        const files = [];
        for (const [i, it] of batch.entries()) {
          btn.textContent = t('Getting photos… {pct}%', { pct: Math.round((i / batch.length) * 100) });
          const blob = await fullBlob(it);
          files.push(new File([blob], fileName(it), { type: blob.type }));
        }
        if (navigator.canShare({ files })) {
          try { await navigator.share({ files }); } catch (err) { if (err.name === 'AbortError') return; throw err; }
          saveFrom += batch.length;
          if (saveFrom < list.length) { btn.disabled = false; btn.textContent = t('Save photos {a}–{b}', { a: saveFrom + 1, b: Math.min(list.length, saveFrom + 20) }); return; }
          saveFrom = 0;
          return;
        }
      }
      const files = [];
      for (const [i, it] of list.entries()) {
        btn.textContent = t('Getting photos… {pct}%', { pct: Math.round((i / list.length) * 100) });
        files.push({ name: fileName(it), blob: await fullBlob(it), at: it.at });
      }
      const name = `${String(album.name || 'OmniBeam album').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 60)}.zip`;
      download(await makeZip(files), name);
    } catch {
      alert(t('Could not load this photo. Check the connection and try again.'));
    } finally {
      if (!saveFrom) btn.textContent = label;
      btn.disabled = false;
    }
  };
  // A ZIP without compression (photos and videos are compressed already); up to 4 GB
  const CRC = (() => {
    const tab = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tab[n] = c >>> 0; }
    return tab;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function makeZip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    const used = new Set();
    let offset = 0;
    for (const f of files) {
      let name = f.name;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = f.name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
      used.add(name.toLowerCase());
      const nameBytes = enc.encode(name);
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const crc = crc32(data);
      const d = new Date(f.at || Date.now());
      const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(10, time, true); local.setUint16(12, date, true); local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBytes.length, true);
      parts.push(local.buffer, nameBytes, f.blob);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
      cen.setUint16(12, time, true); cen.setUint16(14, date, true); cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, nameBytes.length, true);
      cen.setUint32(42, offset, true);
      central.push(cen.buffer, nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const size = central.reduce((s, p) => s + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  // ---- Adding photos ----
  let adding = false;
  const MAX_SIDE = 2048; // "Smaller" albums: the same size as Smaller photos in the app
  const loadImage = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
  const toJpeg = (source, w, h, side, quality) => {
    const s = Math.min(1, side / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', quality));
  };
  // -> { blob, name, type, thumb (Blob or null) }
  async function prepare(file) {
    const type = file.type || '';
    if (type.startsWith('image/')) {
      try {
        const { img, url } = await loadImage(file);
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const thumb = await toJpeg(img, w, h, 480, 0.72);
        let blob = file;
        let name = file.name;
        // Smaller: big photos (and every HEIC, which most computers can't open) become a JPG of up to 2048 pixels
        if (album.q !== 'orig' && (Math.max(w, h) > MAX_SIDE || /hei[cf]/i.test(type) || file.size > 3 * 1048576)) {
          const small = await toJpeg(img, w, h, MAX_SIDE, 0.86);
          if (small && small.size < file.size) { blob = small; name = file.name.replace(/\.[^.]*$/, '') + '.jpg'; }
        }
        URL.revokeObjectURL(url);
        return { blob, name, type: blob.type || type, thumb };
      } catch {
        return { blob: file, name: file.name, type, thumb: null }; // a photo this browser can't show (HEIC on Windows)
      }
    }
    if (type.startsWith('video/')) return { blob: file, name: file.name, type, thumb: await videoFrame(file) };
    return { blob: file, name: file.name, type, thumb: null };
  }
  function videoFrame(file) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      const url = URL.createObjectURL(file);
      const done = (b) => { URL.revokeObjectURL(url); resolve(b || null); };
      const timer = setTimeout(() => done(null), 8000);
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
      v.onseeked = async () => { clearTimeout(timer); done(await toJpeg(v, v.videoWidth, v.videoHeight, 480, 0.72).catch(() => null)); };
      v.onerror = () => { clearTimeout(timer); done(null); };
      v.src = url;
    });
  }
  const closedNotice = () => alert(t('The host stopped taking new photos. You can still see and save the ones in the album.'));
  async function addFiles(list) {
    if (adding || !list.length || !info) return;
    // The page may have been open a while (or in the background while photos were picked): ask the server first
    await refresh();
    if (!info.open) { $('#ev-input').value = ''; return closedNotice(); }
    adding = true;
    const bar = $('#ev-bar');
    const from = $('#ev-from').value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40);
    let ok = 0;
    let closed = false;
    const problems = [];
    bar.hidden = false;
    try {
      for (const [i, file] of list.entries()) {
        status(t('Adding {i} of {n}…', { i: i + 1, n: list.length }));
        bar.firstElementChild.style.width = `${Math.round((i / list.length) * 100)}%`;
        const p = await prepare(file);
        if (p.blob.size > info.itemMb * 1048576) { problems.push(t('{file} is too large: up to {size} each.', { file: file.name, size: formatSize(info.itemMb * 1048576) })); continue; }
        const thumb = p.thumb ? await encrypt(key, await p.thumb.arrayBuffer()) : new Uint8Array(0);
        const body = await encrypt(key, await p.blob.arrayBuffer());
        const meta = await seal(key, { v: 1, name: p.name.slice(0, 120), type: p.type.slice(0, 80), from, size: p.blob.size });
        const total = thumb.length + body.length;
        let res;
        try {
          res = await fetch(`/api/album/${id}/add`, {
            method: 'POST', body: new Blob([thumb, body]),
            headers: { 'Content-Type': 'application/octet-stream', 'X-Album-Size': String(total), 'X-Thumb-Size': String(thumb.length), 'X-Album-Meta': meta },
          });
        } catch { problems.push(t('Could not add {file}. Check the connection and try again.', { file: file.name })); continue; }
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          const why = j.error === 'closed' ? t('This album no longer takes new photos.')
            : j.error === 'album-full' || j.error === 'full' ? t('This album is full.')
            : j.error === 'too-many' ? t('Too many photos at once. Try again in a few minutes.')
            : j.error === 'too-large' ? t('{file} is too large: up to {size} each.', { file: file.name, size: formatSize(info.itemMb * 1048576) })
            : t('Could not add {file}. Check the connection and try again.', { file: file.name });
          if (j.error === 'closed') closed = true;
          else problems.push(why);
          if (['closed', 'album-full', 'full', 'too-many'].includes(j.error)) break;
          continue;
        }
        const all = loadMine();
        all[id] = { ...(all[id] || {}), [j.n]: j.del };
        saveMine(all);
        ok++;
      }
    } finally {
      adding = false;
      bar.hidden = true;
      $('#ev-input').value = '';
    }
    await refresh();
    const msg = [ok ? (ok === 1 ? t('1 photo added ✓') : t('{n} photos added ✓', { n: ok })) : '', ...new Set(problems)].filter(Boolean).join(' ');
    if (msg) status(msg);
    if (closed) closedNotice();
  }
  $('#ev-input').addEventListener('change', (e) => addFiles([...e.target.files]));
  const zone = $('#ev-zone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); addFiles([...e.dataTransfer.files].filter((f) => /^(image|video)\//.test(f.type))); });

  // ---- QR code, link, poster ----
  const loadQr = () => new Promise((resolve, reject) => {
    if (window.qrcode) return resolve();
    const s = Object.assign(document.createElement('script'), { src: '/qrcode.js?v=1', onload: resolve, onerror: reject });
    document.head.append(s);
  });
  async function qrSvg() {
    await loadQr();
    const qr = qrcode(0, 'M');
    qr.addData(guestUrl);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }
  $('#ev-qr-btn').onclick = async () => {
    const box = $('#ev-qr');
    if (!box.hidden) { box.hidden = true; return; }
    try {
      box.innerHTML = `${await qrSvg()}<p>${t('Scan to add your photos')}</p>`;
      box.hidden = false;
    } catch {}
  };
  $('#ev-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(guestUrl); } catch {
      const el = Object.assign(document.createElement('textarea'), { value: guestUrl });
      document.body.append(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    status(t('Link copied'));
  };
  async function showPoster() {
    document.body.classList.add('poster');
    $('#ev-poster-page').hidden = false;
    try { $('#ev-poster-qr').innerHTML = await qrSvg(); } catch {}
    setTimeout(() => window.print(), 400);
  }
  $('#ev-poster').onclick = () => window.open(`/e/${id}?poster=1#${keyText}`, '_blank', 'noopener');

  // ---- The host ----
  $('#ev-open').onclick = async () => {
    try {
      const r = await fetch(`/api/album/${id}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Album-Token': TOKEN }, body: JSON.stringify({ open: !info.open }) });
      if (!r.ok) throw new Error();
      info.open = (await r.json()).open;
      draw();
    } catch { alert(t('Could not change it. Try again.')); }
  };
  $('#ev-delete').onclick = async () => {
    if (!confirm(t('Delete this album and all its photos for everyone?'))) return;
    try {
      const r = await fetch(`/api/album/${id}`, { method: 'DELETE', headers: { 'X-Album-Token': TOKEN } });
      if (!r.ok && r.status !== 404) throw new Error();
    } catch { return alert(t('Could not delete it. Try again.')); }
    try { localStorage.setItem('omnibeam-albums', JSON.stringify(JSON.parse(localStorage.getItem('omnibeam-albums') || '[]').filter((a) => a.id !== id))); } catch {}
    status(t('Album deleted'));
    $('#ev-add').hidden = $('#ev-tools').hidden = $('#ev-host').hidden = true;
    $('#ev-grid').innerHTML = '';
  };

  start();
})();
