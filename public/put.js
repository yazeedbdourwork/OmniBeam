// OmniBeam upload page for request links (/r/<id>#<key>), made in the app's ⋯ menu, Request files (request.js).
// The key comes from the part of the address after #, which never reaches the server. Each upload is encrypted
// with its own new key; that key and the file names are sealed with the link's key, so only the device that made
// the link can open them. Format of the file data: the same as share by link (see drop.js).
// The same page runs in the "Send me files" box on other websites (embed-box.html, /embed/r/<id>#<key>.<public key>).
// That code is on a public page, so the link's key there is public too: it only opens what the person asks for.
// Each upload's own key and names are then sealed to the requesting device's public key instead (ECDH P-256: a new
// key pair for every upload, SHA-256 of "omnibeam-x1:" + the shared secret is the AES-GCM key, the box is
// "x1.<this upload's public key>.<box>"), so only that device, which keeps the private key, can open them.
'use strict';
(function () {
  const TEXT = {
    ar: {
      "Powered by OmniBeam": "مدعوم من OmniBeam",
      "Send files": "أرسل الملفات",
      "Send files to {name}": "أرسل الملفات إلى {name}",
      "Loading…": "جارٍ التحميل…",
      "This link needs a PIN. Ask the person who sent it.": "هذا الرابط يحتاج إلى رمز PIN. اطلبه من الشخص الذي أرسله.",
      "Open": "فتح",
      "The PIN has 4 to 8 digits.": "رمز PIN يتكون من 4 إلى 8 أرقام.",
      "Wrong PIN. {n} tries left.": "رمز PIN خاطئ. بقيت {n} محاولات.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "محاولات خاطئة كثيرة: هذا الرابط مقفل. اطلب من المرسل رابطًا جديدًا.",
      "Your name (optional)": "اسمك (اختياري)",
      "Choose files": "اختر الملفات",
      "or drop them here": "أو أفلتها هنا",
      "Send": "إرسال",
      "Send more files": "أرسل ملفات أخرى",
      "End-to-end encrypted: the files are encrypted on this device and only the person who asked can open them. The OmniBeam server can't read them.": "مشفّرة من طرف إلى طرف: تُشفَّر الملفات على هذا الجهاز ولا يفتحها إلا الشخص الذي طلبها. خادم OmniBeam لا يستطيع قراءتها.",
      "Send your own files with OmniBeam: free, no app": "أرسل ملفاتك أنت مع OmniBeam: مجانًا ودون تطبيق",
      "Open OmniBeam": "افتح OmniBeam",
      "Pick the files to send. Up to {size} at a time. This link works for {time}.": "اختر الملفات التي تريد إرسالها. حتى {size} في كل مرة. يعمل هذا الرابط لمدة {time}.",
      "This request link has ended or was deleted.": "انتهى رابط الطلب هذا أو تم حذفه.",
      "This link is incomplete. Copy the whole link, including the part after #.": "هذا الرابط غير مكتمل. انسخ الرابط كاملًا، بما في ذلك الجزء بعد #.",
      "This request link already got all the files it allows.": "رابط الطلب هذا استلم كل الملفات المسموح بها.",
      "{n} files · {size}": "{n} ملفات · {size}",
      "1 file · {size}": "ملف واحد · {size}",
      "Too large: up to {size} at a time.": "كبير جدًا: حتى {size} في كل مرة.",
      "Encrypting and sending… {pct}%": "جارٍ التشفير والإرسال… {pct}%",
      "Sent ✓ {name} gets the files on their device.": "تم الإرسال ✓ سيستلم {name} الملفات على جهازه.",
      "The person who asked": "الشخص الذي طلبها",
      "Could not send. Check the connection and try again.": "تعذّر الإرسال. تحقق من الاتصال وحاول مجددًا.",
      "Too many uploads from your network. Try again later.": "عمليات رفع كثيرة من شبكتك. حاول لاحقًا.",
      "The server is full right now. Try again later.": "الخادم ممتلئ الآن. حاول لاحقًا.",
      "Remove": "إزالة",
      "{n} h": "{n} ساعة",
      "{n} min": "{n} دقيقة",
    },
    fr: {
      "Powered by OmniBeam": "Propulsé par OmniBeam",
      "Send files": "Envoyer des fichiers",
      "Send files to {name}": "Envoyer des fichiers à {name}",
      "Loading…": "Chargement…",
      "This link needs a PIN. Ask the person who sent it.": "Ce lien demande un code PIN. Demandez-le à la personne qui l'a envoyé.",
      "Open": "Ouvrir",
      "The PIN has 4 to 8 digits.": "Le code PIN compte 4 à 8 chiffres.",
      "Wrong PIN. {n} tries left.": "Code PIN incorrect. Encore {n} essais.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "Trop de codes PIN incorrects : ce lien est bloqué. Demandez un nouveau lien à l'expéditeur.",
      "Your name (optional)": "Votre nom (facultatif)",
      "Choose files": "Choisir des fichiers",
      "or drop them here": "ou déposez-les ici",
      "Send": "Envoyer",
      "Send more files": "Envoyer d'autres fichiers",
      "End-to-end encrypted: the files are encrypted on this device and only the person who asked can open them. The OmniBeam server can't read them.": "Chiffré de bout en bout : les fichiers sont chiffrés sur cet appareil et seule la personne qui les a demandés peut les ouvrir. Le serveur OmniBeam ne peut pas les lire.",
      "Send your own files with OmniBeam: free, no app": "Envoyez vos propres fichiers avec OmniBeam : gratuit, sans application",
      "Open OmniBeam": "Ouvrir OmniBeam",
      "Pick the files to send. Up to {size} at a time. This link works for {time}.": "Choisissez les fichiers à envoyer. Jusqu'à {size} à la fois. Ce lien fonctionne encore {time}.",
      "This request link has ended or was deleted.": "Ce lien de demande a expiré ou a été supprimé.",
      "This link is incomplete. Copy the whole link, including the part after #.": "Ce lien est incomplet. Copiez le lien en entier, y compris la partie après #.",
      "This request link already got all the files it allows.": "Ce lien de demande a déjà reçu tous les fichiers prévus.",
      "{n} files · {size}": "{n} fichiers · {size}",
      "1 file · {size}": "1 fichier · {size}",
      "Too large: up to {size} at a time.": "Trop volumineux : jusqu'à {size} à la fois.",
      "Encrypting and sending… {pct}%": "Chiffrement et envoi… {pct} %",
      "Sent ✓ {name} gets the files on their device.": "Envoyé ✓ {name} reçoit les fichiers sur son appareil.",
      "The person who asked": "La personne qui les a demandés",
      "Could not send. Check the connection and try again.": "Envoi impossible. Vérifiez la connexion et réessayez.",
      "Too many uploads from your network. Try again later.": "Trop d'envois depuis votre réseau. Réessayez plus tard.",
      "The server is full right now. Try again later.": "Le serveur est plein pour le moment. Réessayez plus tard.",
      "Remove": "Retirer",
      "{n} h": "{n} h",
      "{n} min": "{n} min",
    },
    es: {
      "Powered by OmniBeam": "Con la tecnología de OmniBeam",
      "Send files": "Enviar archivos",
      "Send files to {name}": "Enviar archivos a {name}",
      "Loading…": "Cargando…",
      "This link needs a PIN. Ask the person who sent it.": "Este enlace necesita un PIN. Pídeselo a quien te lo envió.",
      "Open": "Abrir",
      "The PIN has 4 to 8 digits.": "El PIN tiene de 4 a 8 dígitos.",
      "Wrong PIN. {n} tries left.": "PIN incorrecto. Quedan {n} intentos.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "Demasiados PIN incorrectos: este enlace está bloqueado. Pide un enlace nuevo a quien lo envió.",
      "Your name (optional)": "Tu nombre (opcional)",
      "Choose files": "Elegir archivos",
      "or drop them here": "o suéltalos aquí",
      "Send": "Enviar",
      "Send more files": "Enviar más archivos",
      "End-to-end encrypted: the files are encrypted on this device and only the person who asked can open them. The OmniBeam server can't read them.": "Cifrado de extremo a extremo: los archivos se cifran en este dispositivo y solo la persona que los pidió puede abrirlos. El servidor de OmniBeam no puede leerlos.",
      "Send your own files with OmniBeam: free, no app": "Envía tus propios archivos con OmniBeam: gratis y sin app",
      "Open OmniBeam": "Abrir OmniBeam",
      "Pick the files to send. Up to {size} at a time. This link works for {time}.": "Elige los archivos que quieres enviar. Hasta {size} cada vez. Este enlace funciona durante {time}.",
      "This request link has ended or was deleted.": "Este enlace de solicitud ha caducado o se ha borrado.",
      "This link is incomplete. Copy the whole link, including the part after #.": "Este enlace está incompleto. Copia el enlace entero, incluida la parte después de #.",
      "This request link already got all the files it allows.": "Este enlace de solicitud ya recibió todos los archivos que permite.",
      "{n} files · {size}": "{n} archivos · {size}",
      "1 file · {size}": "1 archivo · {size}",
      "Too large: up to {size} at a time.": "Demasiado grande: hasta {size} cada vez.",
      "Encrypting and sending… {pct}%": "Cifrando y enviando… {pct} %",
      "Sent ✓ {name} gets the files on their device.": "Enviado ✓ {name} recibe los archivos en su dispositivo.",
      "The person who asked": "La persona que los pidió",
      "Could not send. Check the connection and try again.": "No se pudo enviar. Revisa la conexión y vuelve a intentarlo.",
      "Too many uploads from your network. Try again later.": "Demasiadas subidas desde tu red. Inténtalo más tarde.",
      "The server is full right now. Try again later.": "El servidor está lleno ahora mismo. Inténtalo más tarde.",
      "Remove": "Quitar",
      "{n} h": "{n} h",
      "{n} min": "{n} min",
    },
    tr: {
      "Powered by OmniBeam": "OmniBeam ile çalışır",
      "Send files": "Dosya gönder",
      "Send files to {name}": "{name} adlı kişiye dosya gönder",
      "Loading…": "Yükleniyor…",
      "This link needs a PIN. Ask the person who sent it.": "Bu bağlantı bir PIN istiyor. Gönderen kişiye sorun.",
      "Open": "Aç",
      "The PIN has 4 to 8 digits.": "PIN 4 ile 8 rakamdan oluşur.",
      "Wrong PIN. {n} tries left.": "Yanlış PIN. {n} deneme hakkı kaldı.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "Çok fazla yanlış PIN: bu bağlantı kilitlendi. Gönderenden yeni bir bağlantı isteyin.",
      "Your name (optional)": "Adınız (isteğe bağlı)",
      "Choose files": "Dosya seç",
      "or drop them here": "ya da buraya bırakın",
      "Send": "Gönder",
      "Send more files": "Başka dosya gönder",
      "End-to-end encrypted: the files are encrypted on this device and only the person who asked can open them. The OmniBeam server can't read them.": "Uçtan uca şifreli: dosyalar bu cihazda şifrelenir ve yalnızca isteyen kişi açabilir. OmniBeam sunucusu onları okuyamaz.",
      "Send your own files with OmniBeam: free, no app": "Kendi dosyalarınızı OmniBeam ile gönderin: ücretsiz, uygulama gerekmez",
      "Open OmniBeam": "OmniBeam'i aç",
      "Pick the files to send. Up to {size} at a time. This link works for {time}.": "Göndermek istediğiniz dosyaları seçin. Her seferde en fazla {size}. Bu bağlantı {time} daha çalışır.",
      "This request link has ended or was deleted.": "Bu istek bağlantısının süresi dolmuş ya da silinmiş.",
      "This link is incomplete. Copy the whole link, including the part after #.": "Bu bağlantı eksik. # işaretinden sonraki kısım dahil bağlantının tamamını kopyalayın.",
      "This request link already got all the files it allows.": "Bu istek bağlantısı izin verdiği tüm dosyaları zaten aldı.",
      "{n} files · {size}": "{n} dosya · {size}",
      "1 file · {size}": "1 dosya · {size}",
      "Too large: up to {size} at a time.": "Çok büyük: her seferde en fazla {size}.",
      "Encrypting and sending… {pct}%": "Şifreleniyor ve gönderiliyor… %{pct}",
      "Sent ✓ {name} gets the files on their device.": "Gönderildi ✓ {name} dosyaları kendi cihazında alır.",
      "The person who asked": "İsteyen kişi",
      "Could not send. Check the connection and try again.": "Gönderilemedi. Bağlantıyı kontrol edip tekrar deneyin.",
      "Too many uploads from your network. Try again later.": "Ağınızdan çok fazla yükleme yapıldı. Daha sonra tekrar deneyin.",
      "The server is full right now. Try again later.": "Sunucu şu anda dolu. Daha sonra tekrar deneyin.",
      "Remove": "Kaldır",
      "{n} h": "{n} sa",
      "{n} min": "{n} dk",
    },
    de: {
      "Powered by OmniBeam": "Bereitgestellt von OmniBeam",
      "Send files": "Dateien senden",
      "Send files to {name}": "Dateien an {name} senden",
      "Loading…": "Lädt…",
      "This link needs a PIN. Ask the person who sent it.": "Dieser Link braucht eine PIN. Frag die Person, die ihn geschickt hat.",
      "Open": "Öffnen",
      "The PIN has 4 to 8 digits.": "Die PIN hat 4 bis 8 Ziffern.",
      "Wrong PIN. {n} tries left.": "Falsche PIN. Noch {n} Versuche.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "Zu viele falsche PINs: Dieser Link ist gesperrt. Bitte den Absender um einen neuen Link.",
      "Your name (optional)": "Dein Name (optional)",
      "Choose files": "Dateien auswählen",
      "or drop them here": "oder hier ablegen",
      "Send": "Senden",
      "Send more files": "Weitere Dateien senden",
      "End-to-end encrypted: the files are encrypted on this device and only the person who asked can open them. The OmniBeam server can't read them.": "Ende-zu-Ende verschlüsselt: Die Dateien werden auf diesem Gerät verschlüsselt, und nur die Person, die sie angefragt hat, kann sie öffnen. Der OmniBeam-Server kann sie nicht lesen.",
      "Send your own files with OmniBeam: free, no app": "Sende deine eigenen Dateien mit OmniBeam: kostenlos, ohne App",
      "Open OmniBeam": "OmniBeam öffnen",
      "Pick the files to send. Up to {size} at a time. This link works for {time}.": "Wähle die Dateien aus, die du senden willst. Bis zu {size} auf einmal. Dieser Link funktioniert noch {time}.",
      "This request link has ended or was deleted.": "Dieser Anfrage-Link ist abgelaufen oder wurde gelöscht.",
      "This link is incomplete. Copy the whole link, including the part after #.": "Dieser Link ist unvollständig. Kopiere den ganzen Link, auch den Teil nach #.",
      "This request link already got all the files it allows.": "Dieser Anfrage-Link hat schon alle erlaubten Dateien bekommen.",
      "{n} files · {size}": "{n} Dateien · {size}",
      "1 file · {size}": "1 Datei · {size}",
      "Too large: up to {size} at a time.": "Zu groß: bis zu {size} auf einmal.",
      "Encrypting and sending… {pct}%": "Verschlüsseln und senden… {pct} %",
      "Sent ✓ {name} gets the files on their device.": "Gesendet ✓ {name} bekommt die Dateien auf das eigene Gerät.",
      "The person who asked": "Die Person, die gefragt hat",
      "Could not send. Check the connection and try again.": "Senden fehlgeschlagen. Prüfe die Verbindung und versuche es erneut.",
      "Too many uploads from your network. Try again later.": "Zu viele Uploads aus deinem Netzwerk. Versuche es später erneut.",
      "The server is full right now. Try again later.": "Der Server ist gerade voll. Versuche es später erneut.",
      "Remove": "Entfernen",
      "{n} h": "{n} Std.",
      "{n} min": "{n} Min.",
    },
    pt: {
      "Powered by OmniBeam": "Com tecnologia OmniBeam",
      "Send files": "Enviar arquivos",
      "Send files to {name}": "Enviar arquivos para {name}",
      "Loading…": "Carregando…",
      "This link needs a PIN. Ask the person who sent it.": "Este link precisa de um PIN. Peça a quem enviou.",
      "Open": "Abrir",
      "The PIN has 4 to 8 digits.": "O PIN tem de 4 a 8 dígitos.",
      "Wrong PIN. {n} tries left.": "PIN errado. Restam {n} tentativas.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "PINs errados demais: este link foi bloqueado. Peça um novo link a quem enviou.",
      "Your name (optional)": "Seu nome (opcional)",
      "Choose files": "Escolher arquivos",
      "or drop them here": "ou solte-os aqui",
      "Send": "Enviar",
      "Send more files": "Enviar mais arquivos",
      "End-to-end encrypted: the files are encrypted on this device and only the person who asked can open them. The OmniBeam server can't read them.": "Criptografia de ponta a ponta: os arquivos são criptografados neste aparelho e só quem pediu consegue abri-los. O servidor do OmniBeam não consegue lê-los.",
      "Send your own files with OmniBeam: free, no app": "Envie seus próprios arquivos com o OmniBeam: grátis, sem app",
      "Open OmniBeam": "Abrir o OmniBeam",
      "Pick the files to send. Up to {size} at a time. This link works for {time}.": "Escolha os arquivos para enviar. Até {size} por vez. Este link funciona por {time}.",
      "This request link has ended or was deleted.": "Este link de pedido expirou ou foi excluído.",
      "This link is incomplete. Copy the whole link, including the part after #.": "Este link está incompleto. Copie o link inteiro, incluindo a parte depois do #.",
      "This request link already got all the files it allows.": "Este link de pedido já recebeu todos os arquivos permitidos.",
      "{n} files · {size}": "{n} arquivos · {size}",
      "1 file · {size}": "1 arquivo · {size}",
      "Too large: up to {size} at a time.": "Grande demais: até {size} por vez.",
      "Encrypting and sending… {pct}%": "Criptografando e enviando… {pct}%",
      "Sent ✓ {name} gets the files on their device.": "Enviado ✓ {name} recebe os arquivos no aparelho dele.",
      "The person who asked": "A pessoa que pediu",
      "Could not send. Check the connection and try again.": "Não foi possível enviar. Verifique a conexão e tente de novo.",
      "Too many uploads from your network. Try again later.": "Envios demais da sua rede. Tente mais tarde.",
      "The server is full right now. Try again later.": "O servidor está cheio agora. Tente mais tarde.",
      "Remove": "Remover",
      "{n} h": "{n} h",
      "{n} min": "{n} min",
    },
    hi: {
      "Powered by OmniBeam": "OmniBeam द्वारा संचालित",
      "Send files": "फ़ाइलें भेजें",
      "Send files to {name}": "{name} को फ़ाइलें भेजें",
      "Loading…": "लोड हो रहा है…",
      "This link needs a PIN. Ask the person who sent it.": "इस लिंक के लिए PIN चाहिए। भेजने वाले से पूछें।",
      "Open": "खोलें",
      "The PIN has 4 to 8 digits.": "PIN में 4 से 8 अंक होते हैं।",
      "Wrong PIN. {n} tries left.": "गलत PIN। {n} कोशिशें बाकी हैं।",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "बहुत बार गलत PIN: यह लिंक लॉक हो गया है। भेजने वाले से नया लिंक माँगें।",
      "Your name (optional)": "आपका नाम (वैकल्पिक)",
      "Choose files": "फ़ाइलें चुनें",
      "or drop them here": "या उन्हें यहाँ छोड़ें",
      "Send": "भेजें",
      "Send more files": "और फ़ाइलें भेजें",
      "End-to-end encrypted: the files are encrypted on this device and only the person who asked can open them. The OmniBeam server can't read them.": "एंड-टू-एंड एन्क्रिप्टेड: फ़ाइलें इसी डिवाइस पर एन्क्रिप्ट होती हैं और सिर्फ़ माँगने वाला ही उन्हें खोल सकता है। OmniBeam सर्वर उन्हें पढ़ नहीं सकता।",
      "Send your own files with OmniBeam: free, no app": "OmniBeam से अपनी फ़ाइलें भेजें: मुफ़्त, बिना ऐप",
      "Open OmniBeam": "OmniBeam खोलें",
      "Pick the files to send. Up to {size} at a time. This link works for {time}.": "भेजने के लिए फ़ाइलें चुनें। एक बार में {size} तक। यह लिंक {time} तक चलेगा।",
      "This request link has ended or was deleted.": "यह अनुरोध लिंक खत्म हो गया है या हटा दिया गया है।",
      "This link is incomplete. Copy the whole link, including the part after #.": "यह लिंक अधूरा है। # के बाद वाले हिस्से समेत पूरा लिंक कॉपी करें।",
      "This request link already got all the files it allows.": "इस अनुरोध लिंक पर जितनी फ़ाइलें आ सकती थीं, सब आ चुकी हैं।",
      "{n} files · {size}": "{n} फ़ाइलें · {size}",
      "1 file · {size}": "1 फ़ाइल · {size}",
      "Too large: up to {size} at a time.": "बहुत बड़ी: एक बार में {size} तक।",
      "Encrypting and sending… {pct}%": "एन्क्रिप्ट करके भेजा जा रहा है… {pct}%",
      "Sent ✓ {name} gets the files on their device.": "भेज दिया ✓ {name} को फ़ाइलें अपने डिवाइस पर मिलेंगी।",
      "The person who asked": "माँगने वाला व्यक्ति",
      "Could not send. Check the connection and try again.": "भेजा नहीं जा सका। कनेक्शन जाँचें और फिर कोशिश करें।",
      "Too many uploads from your network. Try again later.": "आपके नेटवर्क से बहुत ज़्यादा अपलोड हुए। बाद में कोशिश करें।",
      "The server is full right now. Try again later.": "सर्वर अभी भरा हुआ है। बाद में कोशिश करें।",
      "Remove": "हटाएँ",
      "{n} h": "{n} घंटे",
      "{n} min": "{n} मिनट",
    },
    id: {
      "Powered by OmniBeam": "Didukung oleh OmniBeam",
      "Send files": "Kirim file",
      "Send files to {name}": "Kirim file ke {name}",
      "Loading…": "Memuat…",
      "This link needs a PIN. Ask the person who sent it.": "Tautan ini memerlukan PIN. Tanyakan kepada pengirimnya.",
      "Open": "Buka",
      "The PIN has 4 to 8 digits.": "PIN terdiri dari 4 sampai 8 angka.",
      "Wrong PIN. {n} tries left.": "PIN salah. Sisa {n} percobaan.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "Terlalu banyak PIN salah: tautan ini terkunci. Minta tautan baru kepada pengirim.",
      "Your name (optional)": "Nama Anda (opsional)",
      "Choose files": "Pilih file",
      "or drop them here": "atau letakkan di sini",
      "Send": "Kirim",
      "Send more files": "Kirim file lain",
      "End-to-end encrypted: the files are encrypted on this device and only the person who asked can open them. The OmniBeam server can't read them.": "Terenkripsi ujung ke ujung: file dienkripsi di perangkat ini dan hanya orang yang meminta yang bisa membukanya. Server OmniBeam tidak bisa membacanya.",
      "Send your own files with OmniBeam: free, no app": "Kirim file Anda sendiri dengan OmniBeam: gratis, tanpa aplikasi",
      "Open OmniBeam": "Buka OmniBeam",
      "Pick the files to send. Up to {size} at a time. This link works for {time}.": "Pilih file yang akan dikirim. Hingga {size} sekali kirim. Tautan ini berlaku selama {time}.",
      "This request link has ended or was deleted.": "Tautan permintaan ini sudah berakhir atau dihapus.",
      "This link is incomplete. Copy the whole link, including the part after #.": "Tautan ini tidak lengkap. Salin seluruh tautan, termasuk bagian setelah #.",
      "This request link already got all the files it allows.": "Tautan permintaan ini sudah menerima semua file yang diizinkan.",
      "{n} files · {size}": "{n} file · {size}",
      "1 file · {size}": "1 file · {size}",
      "Too large: up to {size} at a time.": "Terlalu besar: hingga {size} sekali kirim.",
      "Encrypting and sending… {pct}%": "Mengenkripsi dan mengirim… {pct}%",
      "Sent ✓ {name} gets the files on their device.": "Terkirim ✓ {name} menerima file di perangkatnya.",
      "The person who asked": "Orang yang meminta",
      "Could not send. Check the connection and try again.": "Tidak bisa mengirim. Periksa koneksi dan coba lagi.",
      "Too many uploads from your network. Try again later.": "Terlalu banyak unggahan dari jaringan Anda. Coba lagi nanti.",
      "The server is full right now. Try again later.": "Server sedang penuh. Coba lagi nanti.",
      "Remove": "Hapus",
      "{n} h": "{n} jam",
      "{n} min": "{n} mnt",
    },
    ru: {
      "Powered by OmniBeam": "Работает на OmniBeam",
      "Send files": "Отправить файлы",
      "Send files to {name}": "Отправить файлы для {name}",
      "Loading…": "Загрузка…",
      "This link needs a PIN. Ask the person who sent it.": "Для этой ссылки нужен PIN. Спросите у того, кто её прислал.",
      "Open": "Открыть",
      "The PIN has 4 to 8 digits.": "В PIN от 4 до 8 цифр.",
      "Wrong PIN. {n} tries left.": "Неверный PIN. Осталось попыток: {n}.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "Слишком много неверных PIN: ссылка заблокирована. Попросите отправителя прислать новую.",
      "Your name (optional)": "Ваше имя (необязательно)",
      "Choose files": "Выбрать файлы",
      "or drop them here": "или перетащите их сюда",
      "Send": "Отправить",
      "Send more files": "Отправить ещё файлы",
      "End-to-end encrypted: the files are encrypted on this device and only the person who asked can open them. The OmniBeam server can't read them.": "Сквозное шифрование: файлы шифруются на этом устройстве, и открыть их сможет только тот, кто их запросил. Сервер OmniBeam не может их прочитать.",
      "Send your own files with OmniBeam: free, no app": "Отправляйте свои файлы через OmniBeam: бесплатно и без приложения",
      "Open OmniBeam": "Открыть OmniBeam",
      "Pick the files to send. Up to {size} at a time. This link works for {time}.": "Выберите файлы для отправки. До {size} за раз. Ссылка действует ещё {time}.",
      "This request link has ended or was deleted.": "Срок действия этой ссылки-запроса истёк, или её удалили.",
      "This link is incomplete. Copy the whole link, including the part after #.": "Ссылка неполная. Скопируйте её целиком, включая часть после #.",
      "This request link already got all the files it allows.": "По этой ссылке-запросу уже получено столько файлов, сколько разрешено.",
      "{n} files · {size}": "Файлов: {n} · {size}",
      "1 file · {size}": "1 файл · {size}",
      "Too large: up to {size} at a time.": "Слишком большой объём: до {size} за раз.",
      "Encrypting and sending… {pct}%": "Шифрование и отправка… {pct}%",
      "Sent ✓ {name} gets the files on their device.": "Отправлено ✓ {name} получит файлы на своё устройство.",
      "The person who asked": "Тот, кто запросил",
      "Could not send. Check the connection and try again.": "Не удалось отправить. Проверьте соединение и попробуйте снова.",
      "Too many uploads from your network. Try again later.": "Слишком много загрузок из вашей сети. Попробуйте позже.",
      "The server is full right now. Try again later.": "Сервер сейчас заполнен. Попробуйте позже.",
      "Remove": "Убрать",
      "{n} h": "{n} ч",
      "{n} min": "{n} мин",
    },
    ja: {
      "Powered by OmniBeam": "Powered by OmniBeam",
      "Send files": "ファイルを送る",
      "Send files to {name}": "{name} にファイルを送る",
      "Loading…": "読み込み中…",
      "This link needs a PIN. Ask the person who sent it.": "このリンクにはPINが必要です。送ってくれた人に聞いてください。",
      "Open": "開く",
      "The PIN has 4 to 8 digits.": "PINは4〜8桁の数字です。",
      "Wrong PIN. {n} tries left.": "PINが違います。残り{n}回。",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "PINの入力ミスが多すぎるため、このリンクはロックされました。送信者に新しいリンクを頼んでください。",
      "Your name (optional)": "お名前(任意)",
      "Choose files": "ファイルを選ぶ",
      "or drop them here": "またはここにドロップ",
      "Send": "送信",
      "Send more files": "ほかのファイルも送る",
      "End-to-end encrypted: the files are encrypted on this device and only the person who asked can open them. The OmniBeam server can't read them.": "エンドツーエンド暗号化:ファイルはこのデバイスで暗号化され、依頼した人だけが開けます。OmniBeamのサーバーは読めません。",
      "Send your own files with OmniBeam: free, no app": "OmniBeamで自分のファイルも送れます:無料、アプリ不要",
      "Open OmniBeam": "OmniBeamを開く",
      "Pick the files to send. Up to {size} at a time. This link works for {time}.": "送るファイルを選んでください。一度に{size}まで。このリンクはあと{time}有効です。",
      "This request link has ended or was deleted.": "このリクエストリンクは終了したか、削除されました。",
      "This link is incomplete. Copy the whole link, including the part after #.": "このリンクは不完全です。#以降も含めてリンク全体をコピーしてください。",
      "This request link already got all the files it allows.": "このリクエストリンクは、受け取れる数のファイルをすべて受け取りました。",
      "{n} files · {size}": "{n}件のファイル · {size}",
      "1 file · {size}": "1件のファイル · {size}",
      "Too large: up to {size} at a time.": "大きすぎます:一度に{size}までです。",
      "Encrypting and sending… {pct}%": "暗号化して送信中… {pct}%",
      "Sent ✓ {name} gets the files on their device.": "送信しました ✓ {name} のデバイスにファイルが届きます。",
      "The person who asked": "依頼した人",
      "Could not send. Check the connection and try again.": "送信できませんでした。接続を確認してもう一度お試しください。",
      "Too many uploads from your network. Try again later.": "あなたのネットワークからのアップロードが多すぎます。あとでもう一度お試しください。",
      "The server is full right now. Try again later.": "サーバーが混み合っています。あとでもう一度お試しください。",
      "Remove": "削除",
      "{n} h": "{n}時間",
      "{n} min": "{n}分",
    },
    zh: {
      "Powered by OmniBeam": "由 OmniBeam 提供支持",
      "Send files": "发送文件",
      "Send files to {name}": "发送文件给 {name}",
      "Loading…": "正在加载…",
      "This link needs a PIN. Ask the person who sent it.": "此链接需要 PIN。请向发送者索取。",
      "Open": "打开",
      "The PIN has 4 to 8 digits.": "PIN 为 4 到 8 位数字。",
      "Wrong PIN. {n} tries left.": "PIN 错误。还剩 {n} 次机会。",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "PIN 错误次数过多：此链接已锁定。请向发送者索取新链接。",
      "Your name (optional)": "你的名字(可选)",
      "Choose files": "选择文件",
      "or drop them here": "或拖放到这里",
      "Send": "发送",
      "Send more files": "发送更多文件",
      "End-to-end encrypted: the files are encrypted on this device and only the person who asked can open them. The OmniBeam server can't read them.": "端到端加密：文件在此设备上加密，只有请求的人才能打开。OmniBeam 服务器无法读取。",
      "Send your own files with OmniBeam: free, no app": "用 OmniBeam 发送你自己的文件：免费，无需应用",
      "Open OmniBeam": "打开 OmniBeam",
      "Pick the files to send. Up to {size} at a time. This link works for {time}.": "选择要发送的文件。每次最多 {size}。此链接还有效 {time}。",
      "This request link has ended or was deleted.": "此请求链接已结束或已被删除。",
      "This link is incomplete. Copy the whole link, including the part after #.": "此链接不完整。请复制完整链接，包括 # 后面的部分。",
      "This request link already got all the files it allows.": "此请求链接已收到允许的全部文件。",
      "{n} files · {size}": "{n} 个文件 · {size}",
      "1 file · {size}": "1 个文件 · {size}",
      "Too large: up to {size} at a time.": "太大了：每次最多 {size}。",
      "Encrypting and sending… {pct}%": "正在加密并发送… {pct}%",
      "Sent ✓ {name} gets the files on their device.": "已发送 ✓ {name} 会在自己的设备上收到文件。",
      "The person who asked": "请求者",
      "Could not send. Check the connection and try again.": "无法发送。请检查连接后重试。",
      "Too many uploads from your network. Try again later.": "你的网络上传次数过多。请稍后再试。",
      "The server is full right now. Try again later.": "服务器暂时已满。请稍后再试。",
      "Remove": "移除",
      "{n} h": "{n} 小时",
      "{n} min": "{n} 分钟",
    },
    ko: {
      "Powered by OmniBeam": "Powered by OmniBeam",
      "Send files": "파일 보내기",
      "Send files to {name}": "{name}에게 파일 보내기",
      "Loading…": "불러오는 중…",
      "This link needs a PIN. Ask the person who sent it.": "이 링크에는 PIN이 필요합니다. 보낸 사람에게 물어보세요.",
      "Open": "열기",
      "The PIN has 4 to 8 digits.": "PIN은 4~8자리 숫자입니다.",
      "Wrong PIN. {n} tries left.": "PIN이 틀렸습니다. {n}번 남았습니다.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "잘못된 PIN 입력이 너무 많아 링크가 잠겼습니다. 보낸 사람에게 새 링크를 요청하세요.",
      "Your name (optional)": "이름(선택)",
      "Choose files": "파일 선택",
      "or drop them here": "또는 여기에 끌어다 놓기",
      "Send": "보내기",
      "Send more files": "파일 더 보내기",
      "End-to-end encrypted: the files are encrypted on this device and only the person who asked can open them. The OmniBeam server can't read them.": "종단 간 암호화: 파일은 이 기기에서 암호화되며 요청한 사람만 열 수 있습니다. OmniBeam 서버는 읽을 수 없습니다.",
      "Send your own files with OmniBeam: free, no app": "OmniBeam으로 내 파일도 보내세요: 무료, 앱 필요 없음",
      "Open OmniBeam": "OmniBeam 열기",
      "Pick the files to send. Up to {size} at a time. This link works for {time}.": "보낼 파일을 고르세요. 한 번에 {size}까지. 이 링크는 {time} 동안 작동합니다.",
      "This request link has ended or was deleted.": "이 요청 링크는 끝났거나 삭제되었습니다.",
      "This link is incomplete. Copy the whole link, including the part after #.": "이 링크는 완전하지 않습니다. # 뒤 부분까지 링크 전체를 복사하세요.",
      "This request link already got all the files it allows.": "이 요청 링크는 허용된 파일을 이미 모두 받았습니다.",
      "{n} files · {size}": "파일 {n}개 · {size}",
      "1 file · {size}": "파일 1개 · {size}",
      "Too large: up to {size} at a time.": "너무 큽니다: 한 번에 {size}까지.",
      "Encrypting and sending… {pct}%": "암호화해서 보내는 중… {pct}%",
      "Sent ✓ {name} gets the files on their device.": "보냈습니다 ✓ {name}의 기기로 파일이 도착합니다.",
      "The person who asked": "요청한 사람",
      "Could not send. Check the connection and try again.": "보낼 수 없습니다. 연결을 확인하고 다시 시도하세요.",
      "Too many uploads from your network. Try again later.": "내 네트워크에서 업로드가 너무 많습니다. 나중에 다시 시도하세요.",
      "The server is full right now. Try again later.": "지금은 서버가 가득 찼습니다. 나중에 다시 시도하세요.",
      "Remove": "빼기",
      "{n} h": "{n}시간",
      "{n} min": "{n}분",
    },
    it: {
      "Powered by OmniBeam": "Funziona con OmniBeam",
      "Send files": "Invia file",
      "Send files to {name}": "Invia file a {name}",
      "Loading…": "Caricamento…",
      "This link needs a PIN. Ask the person who sent it.": "Questo link richiede un PIN. Chiedilo a chi te l'ha inviato.",
      "Open": "Apri",
      "The PIN has 4 to 8 digits.": "Il PIN ha da 4 a 8 cifre.",
      "Wrong PIN. {n} tries left.": "PIN errato. Tentativi rimasti: {n}.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "Troppi PIN errati: questo link è bloccato. Chiedi al mittente un nuovo link.",
      "Your name (optional)": "Il tuo nome (facoltativo)",
      "Choose files": "Scegli i file",
      "or drop them here": "o trascinali qui",
      "Send": "Invia",
      "Send more files": "Invia altri file",
      "End-to-end encrypted: the files are encrypted on this device and only the person who asked can open them. The OmniBeam server can't read them.": "Crittografia end-to-end: i file vengono crittografati su questo dispositivo e solo chi li ha chiesti può aprirli. Il server di OmniBeam non può leggerli.",
      "Send your own files with OmniBeam: free, no app": "Invia i tuoi file con OmniBeam: gratis, senza app",
      "Open OmniBeam": "Apri OmniBeam",
      "Pick the files to send. Up to {size} at a time. This link works for {time}.": "Scegli i file da inviare. Fino a {size} alla volta. Questo link funziona per {time}.",
      "This request link has ended or was deleted.": "Questo link di richiesta è scaduto o è stato eliminato.",
      "This link is incomplete. Copy the whole link, including the part after #.": "Questo link è incompleto. Copia tutto il link, compresa la parte dopo #.",
      "This request link already got all the files it allows.": "Questo link di richiesta ha già ricevuto tutti i file consentiti.",
      "{n} files · {size}": "{n} file · {size}",
      "1 file · {size}": "1 file · {size}",
      "Too large: up to {size} at a time.": "Troppo grande: fino a {size} alla volta.",
      "Encrypting and sending… {pct}%": "Crittografia e invio… {pct}%",
      "Sent ✓ {name} gets the files on their device.": "Inviato ✓ {name} riceve i file sul suo dispositivo.",
      "The person who asked": "La persona che li ha chiesti",
      "Could not send. Check the connection and try again.": "Impossibile inviare. Controlla la connessione e riprova.",
      "Too many uploads from your network. Try again later.": "Troppi caricamenti dalla tua rete. Riprova più tardi.",
      "The server is full right now. Try again later.": "Il server è pieno in questo momento. Riprova più tardi.",
      "Remove": "Rimuovi",
      "{n} h": "{n} h",
      "{n} min": "{n} min",
    },
    ur: {
      "Powered by OmniBeam": "OmniBeam کے ذریعے",
      "Send files": "فائلیں بھیجیں",
      "Send files to {name}": "{name} کو فائلیں بھیجیں",
      "Loading…": "لوڈ ہو رہا ہے…",
      "This link needs a PIN. Ask the person who sent it.": "اس لنک کے لیے PIN چاہیے۔ بھیجنے والے سے پوچھیں۔",
      "Open": "کھولیں",
      "The PIN has 4 to 8 digits.": "PIN میں 4 سے 8 ہندسے ہوتے ہیں۔",
      "Wrong PIN. {n} tries left.": "غلط PIN۔ {n} کوششیں باقی ہیں۔",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "بہت بار غلط PIN: یہ لنک لاک ہو گیا ہے۔ بھیجنے والے سے نیا لنک مانگیں۔",
      "Your name (optional)": "آپ کا نام (اختیاری)",
      "Choose files": "فائلیں چنیں",
      "or drop them here": "یا انہیں یہاں چھوڑیں",
      "Send": "بھیجیں",
      "Send more files": "مزید فائلیں بھیجیں",
      "End-to-end encrypted: the files are encrypted on this device and only the person who asked can open them. The OmniBeam server can't read them.": "اینڈ ٹو اینڈ انکرپٹڈ: فائلیں اسی ڈیوائس پر انکرپٹ ہوتی ہیں اور صرف مانگنے والا انہیں کھول سکتا ہے۔ OmniBeam سرور انہیں پڑھ نہیں سکتا۔",
      "Send your own files with OmniBeam: free, no app": "OmniBeam سے اپنی فائلیں بھیجیں: مفت، بغیر ایپ",
      "Open OmniBeam": "OmniBeam کھولیں",
      "Pick the files to send. Up to {size} at a time. This link works for {time}.": "بھیجنے کے لیے فائلیں چنیں۔ ایک بار میں {size} تک۔ یہ لنک {time} تک کام کرے گا۔",
      "This request link has ended or was deleted.": "یہ درخواست کا لنک ختم ہو گیا ہے یا حذف کر دیا گیا ہے۔",
      "This link is incomplete. Copy the whole link, including the part after #.": "یہ لنک نامکمل ہے۔ # کے بعد والے حصے سمیت پورا لنک کاپی کریں۔",
      "This request link already got all the files it allows.": "اس درخواست کے لنک پر جتنی فائلیں آ سکتی تھیں سب آ چکی ہیں۔",
      "{n} files · {size}": "{n} فائلیں · {size}",
      "1 file · {size}": "1 فائل · {size}",
      "Too large: up to {size} at a time.": "بہت بڑا: ایک بار میں {size} تک۔",
      "Encrypting and sending… {pct}%": "انکرپٹ کر کے بھیجا جا رہا ہے… {pct}%",
      "Sent ✓ {name} gets the files on their device.": "بھیج دیا ✓ {name} کو فائلیں اپنی ڈیوائس پر ملیں گی۔",
      "The person who asked": "مانگنے والا شخص",
      "Could not send. Check the connection and try again.": "بھیجا نہیں جا سکا۔ کنکشن چیک کر کے دوبارہ کوشش کریں۔",
      "Too many uploads from your network. Try again later.": "آپ کے نیٹ ورک سے بہت زیادہ اپ لوڈز۔ بعد میں کوشش کریں۔",
      "The server is full right now. Try again later.": "سرور ابھی بھرا ہوا ہے۔ بعد میں کوشش کریں۔",
      "Remove": "ہٹائیں",
      "{n} h": "{n} گھنٹے",
      "{n} min": "{n} منٹ",
    },
  };
  let lang = 'en';
  try { lang = localStorage.getItem('omnibeam-lang') || ''; } catch {}
  // The website box says its language in the address (?lang=ar)
  const askedLang = new URLSearchParams(location.search).get('lang');
  if (askedLang && (TEXT[askedLang] || askedLang === 'en')) lang = askedLang;
  const EMBED = document.body.classList.contains('embed');
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
    document.title = `${t('Send files')} | OmniBeam`;
    for (const a of document.querySelectorAll('a[href="/"]')) a.href = `/${lang}/`;
  }

  const $ = (s) => document.querySelector(s);
  const status = (text) => { $('#drop-status').textContent = text; };
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
  const ivFor = (n) => {
    const v = new Uint8Array(12);
    new DataView(v.buffer).setUint32(8, n);
    return v;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const id = location.pathname.split('/').pop();
  const [keyText = '', pubText = ''] = location.hash.slice(1).split('.');
  let key, info, asker = '', devicePub = null;
  let pinHeader = {};
  let picked = [];
  let busy = false;
  const pinProof = async (pin) => b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`omnibeam-pin:${pin}:${keyText}`)));

  function askPin(first) {
    const form = $('#drop-pin');
    const input = $('#drop-pin-input');
    if (first.status === 423) { status(t('Too many wrong PINs: this link is locked. Ask the sender for a new link.')); return Promise.resolve(null); }
    form.hidden = false;
    status('');
    input.focus();
    return new Promise((resolve) => {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const pin = input.value.replace(/\D/g, '');
        if (pin.length < 4) return status(t('The PIN has 4 to 8 digits.'));
        const header = { 'X-Drop-Pin': await pinProof(pin) };
        const r = await fetch(`/api/request/${id}`, { cache: 'no-store', headers: header }).catch(() => null);
        if (!r) return status(t('Could not send. Check the connection and try again.'));
        if (r.ok) { pinHeader = header; form.hidden = true; return resolve(r); }
        const body = await r.json().catch(() => ({}));
        if (r.status === 423) { form.hidden = true; status(t('Too many wrong PINs: this link is locked. Ask the sender for a new link.')); return resolve(null); }
        if (r.status === 403) { input.value = ''; input.focus(); return status(t('Wrong PIN. {n} tries left.', { n: body.left ?? '?' })); }
        form.hidden = true;
        status(t('This request link has ended or was deleted.'));
        resolve(null);
      };
    });
  }

  // The request: { v, name (the asking device), ask (what they asked for) }, encrypted with the key in the link
  async function openBox(text) {
    const all = fromB64u(text);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, key, all.subarray(12));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  async function sealBox(obj, boxKey = key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, boxKey, new TextEncoder().encode(JSON.stringify(obj)));
    const out = new Uint8Array(12 + ct.byteLength);
    out.set(iv);
    out.set(new Uint8Array(ct), 12);
    return b64u(out);
  }
  // Sealed to the requesting device's public key (see the top of this file)
  async function sealToDevice(obj) {
    const mine = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: devicePub }, mine.privateKey, 256));
    const label = new TextEncoder().encode('omnibeam-x1:');
    const both = new Uint8Array(label.length + shared.length);
    both.set(label);
    both.set(shared, label.length);
    const boxKey = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', both), 'AES-GCM', false, ['encrypt']);
    return `x1.${b64u(await crypto.subtle.exportKey('raw', mine.publicKey))}.${await sealBox(obj, boxKey)}`;
  }

  function ready() {
    const left = info.expires - Date.now();
    const time = left >= 3600000 ? t('{n} h', { n: Math.round(left / 3600000) }) : t('{n} min', { n: Math.max(1, Math.round(left / 60000)) });
    if (info.max && info.left === 0) return status(t('This request link already got all the files it allows.'));
    status(t('Pick the files to send. Up to {size} at a time. This link works for {time}.', { size: formatSize(info.maxMb * 1048576), time }));
    $('#req-form').hidden = false;
  }

  async function init() {
    if (!/^[A-Za-z0-9_-]{20,24}$/.test(keyText) || !window.crypto?.subtle) return status(t('This link is incomplete. Copy the whole link, including the part after #.'));
    try {
      key = await crypto.subtle.importKey('raw', fromB64u(keyText), 'AES-GCM', false, ['encrypt', 'decrypt']);
      if (pubText) devicePub = await crypto.subtle.importKey('raw', fromB64u(pubText), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    } catch {
      return status(t('This link is incomplete. Copy the whole link, including the part after #.'));
    }
    let r = await fetch(`/api/request/${id}`, { cache: 'no-store' }).catch(() => null);
    if (r && (r.status === 401 || r.status === 423)) {
      r = await askPin(r);
      if (!r) return;
    }
    if (!r || !r.ok) return status(r ? t('This request link has ended or was deleted.') : t('Could not send. Check the connection and try again.'));
    info = await r.json();
    try {
      const meta = await openBox(info.meta);
      asker = String(meta.name || '').slice(0, 60);
      const ask = String(meta.ask || '').slice(0, 300);
      if (asker) {
        $('#req-title').textContent = t('Send files to {name}', { name: asker });
        document.title = `${t('Send files to {name}', { name: asker })} | OmniBeam`;
      }
      if (ask) { $('#req-ask').textContent = ask; $('#req-ask').hidden = false; }
    } catch {
      return status(t('This link is incomplete. Copy the whole link, including the part after #.'));
    }
    try { $('#req-from').value = localStorage.getItem('omnibeam-req-from') || ''; } catch {}
    ready();
  }

  function render() {
    const list = $('#drop-files');
    list.innerHTML = '';
    picked.forEach((f, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="n"></span><span class="s"></span><button type="button" class="x">×</button>';
      li.querySelector('.n').textContent = f.name;
      li.querySelector('.s').textContent = formatSize(f.size);
      const x = li.querySelector('.x');
      x.title = x.ariaLabel = t('Remove');
      x.onclick = () => { picked.splice(i, 1); render(); };
      list.appendChild(li);
    });
    const size = picked.reduce((s, f) => s + f.size, 0);
    $('#req-send').hidden = !picked.length;
    if (picked.length) {
      $('#req-send').textContent = `${t('Send')} · ${picked.length > 1 ? t('{n} files · {size}', { n: picked.length, size: formatSize(size) }) : t('1 file · {size}', { size: formatSize(size) })}`;
    }
  }
  function add(files) {
    if (busy) return;
    for (const f of files) if (f.size > 0 && !picked.some((p) => p.name === f.name && p.size === f.size)) picked.push(f);
    const size = picked.reduce((s, f) => s + f.size, 0);
    if (size > info.maxMb * 1048576) status(t('Too large: up to {size} at a time.', { size: formatSize(info.maxMb * 1048576) }));
    render();
  }
  $('#req-input').onchange = (e) => { add([...e.target.files]); e.target.value = ''; };
  const zone = $('#req-zone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); add([...(e.dataTransfer?.files || [])]); });
  // Dropped anywhere on the page: the same
  document.addEventListener('dragover', (e) => { if (!$('#req-form').hidden) e.preventDefault(); });
  document.addEventListener('drop', (e) => { if (!$('#req-form').hidden) { e.preventDefault(); add([...(e.dataTransfer?.files || [])]); } });

  async function put(url, token, body) {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(url, { method: 'PUT', headers: { 'X-Drop-Token': token, 'Content-Type': 'application/octet-stream' }, body });
        if (r.ok) return r.json();
        if (r.status < 500 && r.status !== 409) throw Object.assign(new Error(''), { fatal: true });
        if (r.status === 409) {
          const j = await r.json().catch(() => ({}));
          if (j.got > Number(url.split('/').pop())) return j;
        }
      } catch (err) {
        if (err.fatal || attempt >= 4) throw err;
      }
      await sleep(1000 * (attempt + 1));
    }
  }

  async function send() {
    if (busy || !picked.length) return;
    const files = picked.slice();
    const size = files.reduce((s, f) => s + f.size, 0);
    if (size > info.maxMb * 1048576) return status(t('Too large: up to {size} at a time.', { size: formatSize(info.maxMb * 1048576) }));
    busy = true;
    const from = $('#req-from').value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40);
    try { localStorage.setItem('omnibeam-req-from', from); } catch {}
    $('#req-form').hidden = true;
    const bar = $('#drop-bar');
    bar.hidden = false;
    const setBar = (frac) => {
      bar.firstElementChild.style.width = `${(frac * 100).toFixed(1)}%`;
      status(t('Encrypting and sending… {pct}%', { pct: Math.floor(frac * 100) }));
    };
    setBar(0);
    let up = null;
    try {
      // Each upload gets its own key; the link's key only seals that key with the names
      const raw = crypto.getRandomValues(new Uint8Array(16));
      const fileKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
      const box = { v: 1, k: b64u(raw), from, files: files.map((f) => ({ name: f.name, size: f.size, type: f.type || '' })) };
      const meta = devicePub ? await sealToDevice(box) : await sealBox(box);
      const r = await fetch(`/api/request/${id}/upload`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...pinHeader }, body: JSON.stringify({ size, meta, embed: EMBED }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j.error === 'full-link' ? t('This request link already got all the files it allows.')
          : j.error === 'ended' || r.status === 404 ? t('This request link has ended or was deleted.')
          : j.error === 'too-many' ? t('Too many uploads from your network. Try again later.')
          : j.error === 'full' ? t('The server is full right now. Try again later.')
          : j.error === 'too-large' ? t('Too large: up to {size} at a time.', { size: formatSize(info.maxMb * 1048576) })
          : '');
      }
      up = j;
      const all = new Blob(files);
      const parts = Math.max(1, Math.ceil(size / j.part));
      for (let n = 0; n < parts; n++) {
        const plain = await all.slice(n * j.part, Math.min(size, (n + 1) * j.part)).arrayBuffer();
        const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivFor(n) }, fileKey, plain);
        await put(`/api/drop/${j.id}/${n}`, j.token, sealed);
        setBar((n + 1) / parts);
      }
      up = null;
      picked = [];
      render();
      bar.hidden = true;
      status(t('Sent ✓ {name} gets the files on their device.', { name: asker || t('The person who asked') }));
      if (info.max) info.left = Math.max(0, (info.left ?? info.max) - 1);
      $('#req-more').hidden = !!info.max && info.left === 0;
    } catch (err) {
      if (up) fetch(`/api/drop/${up.id}`, { method: 'DELETE', headers: { 'X-Drop-Token': up.token } }).catch(() => {});
      bar.hidden = true;
      window.omniReport?.('link', 'Request upload failed: ' + (err.message || err.name || 'unknown'), { size });
      status(err.message || t('Could not send. Check the connection and try again.'));
      if (!err.message) $('#req-form').hidden = false;
    } finally {
      busy = false;
    }
  }
  $('#req-send').onclick = send;
  $('#req-more').onclick = () => { $('#req-more').hidden = true; ready(); };
  init().catch((err) => {
    window.omniReport?.('link', 'Could not open the request link: ' + ((err && err.message) || 'unknown'));
    status(t('Could not send. Check the connection and try again.'));
  });
})();
