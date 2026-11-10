// OmniBeam download page for files shared by link (/d/<id>#<key>). See drop.js for the format.
// The key comes from the part of the address after #, which never reaches the server. Nothing is downloaded until
// the visitor presses Download, so link previews in chat apps don't use up a one-time link.
'use strict';
(function () {
  const TEXT = {
    ar: {
      "A secret note for you": "ملاحظة سرية لك",
      "End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can't read it.": "مشفّرة من طرف إلى طرف: تُفك الملاحظة على هذا الجهاز، وخادم OmniBeam لا يستطيع قراءتها.",
      "This note was already read, or someone is reading it now.": "هذه الملاحظة قُرئت بالفعل، أو أن أحدًا يقرؤها الآن.",
      "This note can be read once. When you open it, it is deleted from the server.": "يمكن قراءة هذه الملاحظة مرة واحدة. عندما تفتحها تُحذف من الخادم.",
      "Show the note": "اعرض الملاحظة",
      "Copy": "نسخ",
      "Copied": "تم النسخ",
      "The note is now deleted from the server and won't open again. Copy it if you need it.": "حُذفت الملاحظة الآن من الخادم ولن تُفتح مرة أخرى. انسخها إن كنت تحتاجها.",
      "This link needs a PIN. Ask the person who sent it.": "هذا الرابط يحتاج إلى رمز PIN. اطلبه من الشخص الذي أرسله.",
      "Open": "فتح",
      "The PIN has 4 to 8 digits.": "رمز PIN يتكون من 4 إلى 8 أرقام.",
      "Wrong PIN. {n} tries left.": "رمز PIN خاطئ. بقيت {n} محاولات.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "محاولات خاطئة كثيرة: هذا الرابط مقفل. اطلب من المرسل رابطًا جديدًا.",
      "Downloads left: {n} of {max}.": "التنزيلات المتبقية: {n} من {max}.",
      'Open OmniBeam': 'افتح OmniBeam', 'Files shared with you': 'ملفات تمت مشاركتها معك', 'Loading…': 'جارٍ التحميل…', 'Download': 'تنزيل',
      'End-to-end encrypted: the files are decrypted on this device. The OmniBeam server can\'t read them.': 'مشفّرة من طرف إلى طرف: تُفك الملفات على هذا الجهاز، وخادم OmniBeam لا يستطيع قراءتها.',
      'Send your own files with OmniBeam: free, no app': 'أرسل ملفاتك أنت مع OmniBeam: مجانًا ودون تطبيق',
      '{n} files · {size}': '{n} ملفات · {size}', '1 file · {size}': 'ملف واحد · {size}', 'Available for {time}.': 'متاح لمدة {time}.',
      'This link works for one download only.': 'هذا الرابط يعمل لتنزيل واحد فقط.', 'Downloading… {pct}%': 'جارٍ التنزيل… {pct}%',
      'Done. Tap a file to save it.': 'تم. اضغط على ملف لحفظه.', 'Save': 'حفظ',
      'This link has expired or was deleted.': 'انتهت صلاحية هذا الرابط أو تم حذفه.', 'This link is incomplete. Copy the whole link, including the part after #.': 'هذا الرابط غير مكتمل. انسخ الرابط كاملًا، بما في ذلك الجزء بعد #.',
      'Someone is already downloading these files, or the one download was used.': 'هناك من ينزّل هذه الملفات الآن، أو تم استخدام التنزيل الوحيد.',
      'Download failed. Check the connection and try again.': 'فشل التنزيل. تحقق من الاتصال وحاول مجددًا.', '{n} h': '{n} ساعة', '{n} min': '{n} دقيقة',
    },
    fr: {
      "A secret note for you": "Une note secrète pour vous",
      "End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can't read it.": "Chiffrée de bout en bout : la note est déchiffrée sur cet appareil. Le serveur OmniBeam ne peut pas la lire.",
      "This note was already read, or someone is reading it now.": "Cette note a déjà été lue, ou quelqu'un la lit en ce moment.",
      "This note can be read once. When you open it, it is deleted from the server.": "Cette note ne peut être lue qu'une fois. Quand vous l'ouvrez, elle est supprimée du serveur.",
      "Show the note": "Afficher la note",
      "Copy": "Copier",
      "Copied": "Copié",
      "The note is now deleted from the server and won't open again. Copy it if you need it.": "La note est maintenant supprimée du serveur et ne s'ouvrira plus. Copiez-la si vous en avez besoin.",
      "This link needs a PIN. Ask the person who sent it.": "Ce lien demande un code PIN. Demandez-le à la personne qui l'a envoyé.",
      "Open": "Ouvrir",
      "The PIN has 4 to 8 digits.": "Le code PIN compte 4 à 8 chiffres.",
      "Wrong PIN. {n} tries left.": "Code PIN incorrect. Encore {n} essais.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "Trop de codes PIN incorrects : ce lien est bloqué. Demandez un nouveau lien à l'expéditeur.",
      "Downloads left: {n} of {max}.": "Téléchargements restants : {n} sur {max}.",
      'Open OmniBeam': 'Ouvrir OmniBeam', 'Files shared with you': 'Fichiers partagés avec vous', 'Loading…': 'Chargement…', 'Download': 'Télécharger',
      'End-to-end encrypted: the files are decrypted on this device. The OmniBeam server can\'t read them.': 'Chiffré de bout en bout : les fichiers sont déchiffrés sur cet appareil. Le serveur OmniBeam ne peut pas les lire.',
      'Send your own files with OmniBeam: free, no app': 'Envoyez vos propres fichiers avec OmniBeam : gratuit, sans application',
      '{n} files · {size}': '{n} fichiers · {size}', '1 file · {size}': '1 fichier · {size}', 'Available for {time}.': 'Disponible encore {time}.',
      'This link works for one download only.': 'Ce lien ne permet qu\'un seul téléchargement.', 'Downloading… {pct}%': 'Téléchargement… {pct} %',
      'Done. Tap a file to save it.': 'Terminé. Touchez un fichier pour l\'enregistrer.', 'Save': 'Enregistrer',
      'This link has expired or was deleted.': 'Ce lien a expiré ou a été supprimé.', 'This link is incomplete. Copy the whole link, including the part after #.': 'Ce lien est incomplet. Copiez le lien en entier, y compris la partie après #.',
      'Someone is already downloading these files, or the one download was used.': 'Quelqu\'un télécharge déjà ces fichiers, ou l\'unique téléchargement a été utilisé.',
      'Download failed. Check the connection and try again.': 'Échec du téléchargement. Vérifiez la connexion et réessayez.', '{n} h': '{n} h', '{n} min': '{n} min',
    },
    es: {
      "A secret note for you": "Una nota secreta para ti",
      "End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can't read it.": "Cifrada de extremo a extremo: la nota se descifra en este dispositivo. El servidor de OmniBeam no puede leerla.",
      "This note was already read, or someone is reading it now.": "Esta nota ya se leyó, o alguien la está leyendo ahora.",
      "This note can be read once. When you open it, it is deleted from the server.": "Esta nota solo se puede leer una vez. Al abrirla, se borra del servidor.",
      "Show the note": "Mostrar la nota",
      "Copy": "Copiar",
      "Copied": "Copiado",
      "The note is now deleted from the server and won't open again. Copy it if you need it.": "La nota ya se borró del servidor y no se volverá a abrir. Cópiala si la necesitas.",
      "This link needs a PIN. Ask the person who sent it.": "Este enlace necesita un PIN. Pídeselo a quien te lo envió.",
      "Open": "Abrir",
      "The PIN has 4 to 8 digits.": "El PIN tiene de 4 a 8 dígitos.",
      "Wrong PIN. {n} tries left.": "PIN incorrecto. Quedan {n} intentos.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "Demasiados PIN incorrectos: este enlace está bloqueado. Pide un enlace nuevo a quien lo envió.",
      "Downloads left: {n} of {max}.": "Descargas restantes: {n} de {max}.",
      'Open OmniBeam': 'Abrir OmniBeam', 'Files shared with you': 'Archivos compartidos contigo', 'Loading…': 'Cargando…', 'Download': 'Descargar',
      'End-to-end encrypted: the files are decrypted on this device. The OmniBeam server can\'t read them.': 'Cifrado de extremo a extremo: los archivos se descifran en este dispositivo. El servidor de OmniBeam no puede leerlos.',
      'Send your own files with OmniBeam: free, no app': 'Envía tus propios archivos con OmniBeam: gratis y sin app',
      '{n} files · {size}': '{n} archivos · {size}', '1 file · {size}': '1 archivo · {size}', 'Available for {time}.': 'Disponible durante {time}.',
      'This link works for one download only.': 'Este enlace solo permite una descarga.', 'Downloading… {pct}%': 'Descargando… {pct} %',
      'Done. Tap a file to save it.': 'Listo. Toca un archivo para guardarlo.', 'Save': 'Guardar',
      'This link has expired or was deleted.': 'Este enlace ha caducado o se ha borrado.', 'This link is incomplete. Copy the whole link, including the part after #.': 'Este enlace está incompleto. Copia el enlace entero, incluida la parte después de #.',
      'Someone is already downloading these files, or the one download was used.': 'Alguien ya está descargando estos archivos, o ya se usó la única descarga.',
      'Download failed. Check the connection and try again.': 'La descarga ha fallado. Revisa la conexión y vuelve a intentarlo.', '{n} h': '{n} h', '{n} min': '{n} min',
    },
    tr: {
      "A secret note for you": "Size gizli bir not",
      "End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can't read it.": "Uçtan uca şifreli: not bu cihazda çözülür. OmniBeam sunucusu onu okuyamaz.",
      "This note was already read, or someone is reading it now.": "Bu not zaten okundu ya da şu anda biri okuyor.",
      "This note can be read once. When you open it, it is deleted from the server.": "Bu not yalnızca bir kez okunabilir. Açtığınızda sunucudan silinir.",
      "Show the note": "Notu göster",
      "Copy": "Kopyala",
      "Copied": "Kopyalandı",
      "The note is now deleted from the server and won't open again. Copy it if you need it.": "Not artık sunucudan silindi ve bir daha açılmayacak. Gerekirse kopyalayın.",
      "This link needs a PIN. Ask the person who sent it.": "Bu bağlantı bir PIN istiyor. Gönderen kişiye sorun.",
      "Open": "Aç",
      "The PIN has 4 to 8 digits.": "PIN 4 ile 8 rakamdan oluşur.",
      "Wrong PIN. {n} tries left.": "Yanlış PIN. {n} deneme hakkı kaldı.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "Çok fazla yanlış PIN: bu bağlantı kilitlendi. Gönderenden yeni bir bağlantı isteyin.",
      "Downloads left: {n} of {max}.": "Kalan indirme: {n} / {max}.",
      'Open OmniBeam': 'OmniBeam\'i aç', 'Files shared with you': 'Sizinle paylaşılan dosyalar', 'Loading…': 'Yükleniyor…', 'Download': 'İndir',
      'End-to-end encrypted: the files are decrypted on this device. The OmniBeam server can\'t read them.': 'Uçtan uca şifreli: dosyaların şifresi bu cihazda çözülür. OmniBeam sunucusu onları okuyamaz.',
      'Send your own files with OmniBeam: free, no app': 'Kendi dosyalarınızı OmniBeam ile gönderin: ücretsiz, uygulama gerekmez',
      '{n} files · {size}': '{n} dosya · {size}', '1 file · {size}': '1 dosya · {size}', 'Available for {time}.': '{time} daha kullanılabilir.',
      'This link works for one download only.': 'Bu bağlantı yalnızca bir kez indirilebilir.', 'Downloading… {pct}%': 'İndiriliyor… %{pct}',
      'Done. Tap a file to save it.': 'Bitti. Kaydetmek için bir dosyaya dokunun.', 'Save': 'Kaydet',
      'This link has expired or was deleted.': 'Bu bağlantının süresi dolmuş ya da silinmiş.', 'This link is incomplete. Copy the whole link, including the part after #.': 'Bu bağlantı eksik. # işaretinden sonraki kısım dahil bağlantının tamamını kopyalayın.',
      'Someone is already downloading these files, or the one download was used.': 'Bu dosyaları şu anda başka biri indiriyor ya da tek indirme hakkı kullanıldı.',
      'Download failed. Check the connection and try again.': 'İndirme başarısız oldu. Bağlantıyı kontrol edip tekrar deneyin.', '{n} h': '{n} sa', '{n} min': '{n} dk',
    },
    de: {
      "A secret note for you": "Eine geheime Notiz für dich",
      "End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can't read it.": "Ende-zu-Ende-verschlüsselt: Die Notiz wird auf diesem Gerät entschlüsselt. Der OmniBeam-Server kann sie nicht lesen.",
      "This note was already read, or someone is reading it now.": "Diese Notiz wurde schon gelesen, oder jemand liest sie gerade.",
      "This note can be read once. When you open it, it is deleted from the server.": "Diese Notiz kann einmal gelesen werden. Wenn du sie öffnest, wird sie vom Server gelöscht.",
      "Show the note": "Notiz anzeigen",
      "Copy": "Kopieren",
      "Copied": "Kopiert",
      "The note is now deleted from the server and won't open again. Copy it if you need it.": "Die Notiz ist jetzt vom Server gelöscht und öffnet sich nicht noch einmal. Kopiere sie, wenn du sie brauchst.",
      "This link needs a PIN. Ask the person who sent it.": "Dieser Link braucht eine PIN. Frag die Person, die ihn geschickt hat.",
      "Open": "Öffnen",
      "The PIN has 4 to 8 digits.": "Die PIN hat 4 bis 8 Ziffern.",
      "Wrong PIN. {n} tries left.": "Falsche PIN. Noch {n} Versuche.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "Zu viele falsche PINs: Dieser Link ist gesperrt. Bitte den Absender um einen neuen Link.",
      "Downloads left: {n} of {max}.": "Verbleibende Downloads: {n} von {max}.",
      'Open OmniBeam': 'OmniBeam öffnen', 'Files shared with you': 'Mit dir geteilte Dateien', 'Loading…': 'Lädt…', 'Download': 'Herunterladen',
      'End-to-end encrypted: the files are decrypted on this device. The OmniBeam server can\'t read them.': 'Ende-zu-Ende verschlüsselt: Die Dateien werden auf diesem Gerät entschlüsselt. Der OmniBeam-Server kann sie nicht lesen.',
      'Send your own files with OmniBeam: free, no app': 'Sende deine eigenen Dateien mit OmniBeam: kostenlos, ohne App',
      '{n} files · {size}': '{n} Dateien · {size}', '1 file · {size}': '1 Datei · {size}', 'Available for {time}.': 'Verfügbar für {time}.',
      'This link works for one download only.': 'Dieser Link funktioniert nur für einen Download.', 'Downloading… {pct}%': 'Lädt herunter… {pct} %',
      'Done. Tap a file to save it.': 'Fertig. Tippe auf eine Datei, um sie zu speichern.', 'Save': 'Speichern',
      'This link has expired or was deleted.': 'Dieser Link ist abgelaufen oder wurde gelöscht.',
      'This link is incomplete. Copy the whole link, including the part after #.': 'Dieser Link ist unvollständig. Kopiere den ganzen Link, auch den Teil nach #.',
      'Someone is already downloading these files, or the one download was used.': 'Jemand lädt diese Dateien gerade herunter, oder der eine Download wurde schon genutzt.',
      'Download failed. Check the connection and try again.': 'Download fehlgeschlagen. Prüfe die Verbindung und versuche es erneut.',
      '{n} h': '{n} Std.', '{n} min': '{n} Min.',
    },
    pt: {
      "A secret note for you": "Uma nota secreta para você",
      "End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can't read it.": "Criptografada de ponta a ponta: a nota é descriptografada neste aparelho. O servidor do OmniBeam não consegue lê-la.",
      "This note was already read, or someone is reading it now.": "Esta nota já foi lida, ou alguém está lendo agora.",
      "This note can be read once. When you open it, it is deleted from the server.": "Esta nota pode ser lida uma vez. Quando você a abre, ela é apagada do servidor.",
      "Show the note": "Mostrar a nota",
      "Copy": "Copiar",
      "Copied": "Copiado",
      "The note is now deleted from the server and won't open again. Copy it if you need it.": "A nota foi apagada do servidor e não vai abrir de novo. Copie se precisar.",
      "This link needs a PIN. Ask the person who sent it.": "Este link precisa de um PIN. Peça a quem enviou.",
      "Open": "Abrir",
      "The PIN has 4 to 8 digits.": "O PIN tem de 4 a 8 dígitos.",
      "Wrong PIN. {n} tries left.": "PIN errado. Restam {n} tentativas.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "PINs errados demais: este link foi bloqueado. Peça um novo link a quem enviou.",
      "Downloads left: {n} of {max}.": "Downloads restantes: {n} de {max}.",
      'Open OmniBeam': 'Abrir o OmniBeam', 'Files shared with you': 'Arquivos compartilhados com você', 'Loading…': 'Carregando…', 'Download': 'Baixar',
      'End-to-end encrypted: the files are decrypted on this device. The OmniBeam server can\'t read them.': 'Criptografia de ponta a ponta: os arquivos são descriptografados neste dispositivo. O servidor do OmniBeam não consegue lê-los.',
      'Send your own files with OmniBeam: free, no app': 'Envie seus próprios arquivos com o OmniBeam: grátis, sem app',
      '{n} files · {size}': '{n} arquivos · {size}', '1 file · {size}': '1 arquivo · {size}', 'Available for {time}.': 'Disponível por {time}.',
      'This link works for one download only.': 'Este link funciona para um único download.', 'Downloading… {pct}%': 'Baixando… {pct}%',
      'Done. Tap a file to save it.': 'Pronto. Toque em um arquivo para salvar.', 'Save': 'Salvar',
      'This link has expired or was deleted.': 'Este link expirou ou foi excluído.',
      'This link is incomplete. Copy the whole link, including the part after #.': 'Este link está incompleto. Copie o link inteiro, incluindo a parte depois do #.',
      'Someone is already downloading these files, or the one download was used.': 'Alguém já está baixando estes arquivos, ou o único download já foi usado.',
      'Download failed. Check the connection and try again.': 'O download falhou. Verifique a conexão e tente de novo.', '{n} h': '{n} h',
      '{n} min': '{n} min',
    },
    hi: {
      "A secret note for you": "आपके लिए एक गुप्त नोट",
      "End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can't read it.": "एंड-टू-एंड एन्क्रिप्टेड: नोट इसी डिवाइस पर डिक्रिप्ट होता है। OmniBeam सर्वर इसे पढ़ नहीं सकता।",
      "This note was already read, or someone is reading it now.": "यह नोट पहले ही पढ़ा जा चुका है, या कोई इसे अभी पढ़ रहा है।",
      "This note can be read once. When you open it, it is deleted from the server.": "यह नोट सिर्फ़ एक बार पढ़ा जा सकता है। खोलते ही यह सर्वर से हट जाता है।",
      "Show the note": "नोट दिखाएँ",
      "Copy": "कॉपी करें",
      "Copied": "कॉपी हो गया",
      "The note is now deleted from the server and won't open again. Copy it if you need it.": "नोट अब सर्वर से हट गया है और दोबारा नहीं खुलेगा। ज़रूरत हो तो इसे कॉपी कर लें।",
      "This link needs a PIN. Ask the person who sent it.": "इस लिंक के लिए PIN चाहिए। भेजने वाले से पूछें।",
      "Open": "खोलें",
      "The PIN has 4 to 8 digits.": "PIN में 4 से 8 अंक होते हैं।",
      "Wrong PIN. {n} tries left.": "गलत PIN। {n} कोशिशें बाकी हैं।",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "बहुत बार गलत PIN: यह लिंक लॉक हो गया है। भेजने वाले से नया लिंक माँगें।",
      "Downloads left: {n} of {max}.": "बाकी डाउनलोड: {max} में से {n}।",
      'Open OmniBeam': 'OmniBeam खोलें', 'Files shared with you': 'आपके साथ शेयर की गई फ़ाइलें', 'Loading…': 'लोड हो रहा है…',
      'Download': 'डाउनलोड करें',
      'End-to-end encrypted: the files are decrypted on this device. The OmniBeam server can\'t read them.': 'एंड-टू-एंड एन्क्रिप्टेड: फ़ाइलें इसी डिवाइस पर डिक्रिप्ट होती हैं। OmniBeam सर्वर उन्हें पढ़ नहीं सकता।',
      'Send your own files with OmniBeam: free, no app': 'OmniBeam से अपनी फ़ाइलें भेजें: मुफ़्त, बिना ऐप',
      '{n} files · {size}': '{n} फ़ाइलें · {size}', '1 file · {size}': '1 फ़ाइल · {size}', 'Available for {time}.': '{time} तक उपलब्ध।',
      'This link works for one download only.': 'यह लिंक सिर्फ़ एक डाउनलोड के लिए है।', 'Downloading… {pct}%': 'डाउनलोड हो रहा है… {pct}%',
      'Done. Tap a file to save it.': 'हो गया। सेव करने के लिए किसी फ़ाइल पर टैप करें।', 'Save': 'सेव करें',
      'This link has expired or was deleted.': 'इस लिंक की अवधि खत्म हो गई है या इसे हटा दिया गया है।',
      'This link is incomplete. Copy the whole link, including the part after #.': 'यह लिंक अधूरा है। # के बाद वाले हिस्से समेत पूरा लिंक कॉपी करें।',
      'Someone is already downloading these files, or the one download was used.': 'कोई और ये फ़ाइलें अभी डाउनलोड कर रहा है, या एक डाउनलोड पहले ही हो चुका है।',
      'Download failed. Check the connection and try again.': 'डाउनलोड नहीं हो सका। कनेक्शन जाँचें और फिर कोशिश करें।', '{n} h': '{n} घंटे',
      '{n} min': '{n} मिनट',
    },
    id: {
      "A secret note for you": "Catatan rahasia untuk Anda",
      "End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can't read it.": "Terenkripsi ujung ke ujung: catatan didekripsi di perangkat ini. Server OmniBeam tidak bisa membacanya.",
      "This note was already read, or someone is reading it now.": "Catatan ini sudah dibaca, atau seseorang sedang membacanya.",
      "This note can be read once. When you open it, it is deleted from the server.": "Catatan ini hanya bisa dibaca sekali. Saat Anda membukanya, catatan dihapus dari server.",
      "Show the note": "Tampilkan catatan",
      "Copy": "Salin",
      "Copied": "Tersalin",
      "The note is now deleted from the server and won't open again. Copy it if you need it.": "Catatan kini sudah dihapus dari server dan tidak akan terbuka lagi. Salin jika Anda memerlukannya.",
      "This link needs a PIN. Ask the person who sent it.": "Tautan ini memerlukan PIN. Tanyakan kepada pengirimnya.",
      "Open": "Buka",
      "The PIN has 4 to 8 digits.": "PIN terdiri dari 4 sampai 8 angka.",
      "Wrong PIN. {n} tries left.": "PIN salah. Sisa {n} percobaan.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "Terlalu banyak PIN salah: tautan ini dikunci. Minta tautan baru kepada pengirim.",
      "Downloads left: {n} of {max}.": "Sisa unduhan: {n} dari {max}.",
      'Open OmniBeam': 'Buka OmniBeam', 'Files shared with you': 'File yang dibagikan dengan Anda', 'Loading…': 'Memuat…', 'Download': 'Unduh',
      'End-to-end encrypted: the files are decrypted on this device. The OmniBeam server can\'t read them.': 'Terenkripsi end-to-end: file didekripsi di perangkat ini. Server OmniBeam tidak bisa membacanya.',
      'Send your own files with OmniBeam: free, no app': 'Kirim file Anda sendiri dengan OmniBeam: gratis, tanpa aplikasi',
      '{n} files · {size}': '{n} file · {size}', '1 file · {size}': '1 file · {size}', 'Available for {time}.': 'Tersedia selama {time}.',
      'This link works for one download only.': 'Tautan ini hanya untuk satu kali unduh.', 'Downloading… {pct}%': 'Mengunduh… {pct}%',
      'Done. Tap a file to save it.': 'Selesai. Ketuk file untuk menyimpannya.', 'Save': 'Simpan',
      'This link has expired or was deleted.': 'Tautan ini sudah kedaluwarsa atau dihapus.',
      'This link is incomplete. Copy the whole link, including the part after #.': 'Tautan ini tidak lengkap. Salin seluruh tautan, termasuk bagian setelah #.',
      'Someone is already downloading these files, or the one download was used.': 'Seseorang sedang mengunduh file ini, atau satu-satunya unduhan sudah dipakai.',
      'Download failed. Check the connection and try again.': 'Unduhan gagal. Periksa koneksi lalu coba lagi.', '{n} h': '{n} jam',
      '{n} min': '{n} menit',
    },
    ru: {
      "A secret note for you": "Секретная заметка для вас",
      "End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can't read it.": "Сквозное шифрование: заметка расшифровывается на этом устройстве. Сервер OmniBeam не может её прочитать.",
      "This note was already read, or someone is reading it now.": "Эту заметку уже прочитали, или кто-то читает её сейчас.",
      "This note can be read once. When you open it, it is deleted from the server.": "Эту заметку можно прочитать один раз. Когда вы её откроете, она удалится с сервера.",
      "Show the note": "Показать заметку",
      "Copy": "Копировать",
      "Copied": "Скопировано",
      "The note is now deleted from the server and won't open again. Copy it if you need it.": "Заметка удалена с сервера и больше не откроется. Скопируйте её, если она вам нужна.",
      "This link needs a PIN. Ask the person who sent it.": "Для этой ссылки нужен PIN. Спросите у того, кто её прислал.",
      "Open": "Открыть",
      "The PIN has 4 to 8 digits.": "В PIN от 4 до 8 цифр.",
      "Wrong PIN. {n} tries left.": "Неверный PIN. Осталось попыток: {n}.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "Слишком много неверных PIN: ссылка заблокирована. Попросите отправителя прислать новую.",
      "Downloads left: {n} of {max}.": "Осталось скачиваний: {n} из {max}.",
      "Open OmniBeam": "Открыть OmniBeam",
      "Files shared with you": "Файлы для вас",
      "Loading…": "Загрузка…",
      "Download": "Скачать",
      "End-to-end encrypted: the files are decrypted on this device. The OmniBeam server can't read them.": "Сквозное шифрование: файлы расшифровываются на этом устройстве. Сервер OmniBeam не может их прочитать.",
      "Send your own files with OmniBeam: free, no app": "Отправляйте свои файлы через OmniBeam: бесплатно и без приложения",
      "{n} files · {size}": "Файлов: {n} · {size}",
      "1 file · {size}": "1 файл · {size}",
      "Available for {time}.": "Доступно ещё {time}.",
      "This link works for one download only.": "Эта ссылка работает только для одного скачивания.",
      "Downloading… {pct}%": "Скачивание… {pct}%",
      "Done. Tap a file to save it.": "Готово. Нажмите на файл, чтобы сохранить его.",
      "Save": "Сохранить",
      "This link has expired or was deleted.": "Срок действия ссылки истёк, или её удалили.",
      "This link is incomplete. Copy the whole link, including the part after #.": "Ссылка неполная. Скопируйте её целиком, включая часть после #.",
      "Someone is already downloading these files, or the one download was used.": "Кто-то уже скачивает эти файлы, или единственное скачивание уже использовано.",
      "Download failed. Check the connection and try again.": "Скачивание не удалось. Проверьте соединение и попробуйте снова.",
      "{n} h": "{n} ч",
      "{n} min": "{n} мин",
    },
    ja: {
      "A secret note for you": "あなたへのシークレットメモ",
      "End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can't read it.": "エンドツーエンド暗号化:メモはこのデバイスで復号されます。OmniBeamのサーバーは読めません。",
      "This note was already read, or someone is reading it now.": "このメモはすでに読まれたか、今誰かが読んでいます。",
      "This note can be read once. When you open it, it is deleted from the server.": "このメモは一度だけ読めます。開くとサーバーから削除されます。",
      "Show the note": "メモを表示",
      "Copy": "コピー",
      "Copied": "コピーしました",
      "The note is now deleted from the server and won't open again. Copy it if you need it.": "メモはサーバーから削除され、もう開けません。必要ならコピーしてください。",
      "This link needs a PIN. Ask the person who sent it.": "このリンクにはPINが必要です。送ってくれた人に聞いてください。",
      "Open": "開く",
      "The PIN has 4 to 8 digits.": "PINは4〜8桁の数字です。",
      "Wrong PIN. {n} tries left.": "PINが違います。残り{n}回。",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "PINの入力ミスが多すぎるため、このリンクはロックされました。送信者に新しいリンクを頼んでください。",
      "Downloads left: {n} of {max}.": "残りのダウンロード:{max}回中{n}回。",
      "Open OmniBeam": "OmniBeamを開く",
      "Files shared with you": "あなたに共有されたファイル",
      "Loading…": "読み込み中…",
      "Download": "ダウンロード",
      "End-to-end encrypted: the files are decrypted on this device. The OmniBeam server can't read them.": "エンドツーエンド暗号化:ファイルはこのデバイスで復号されます。OmniBeamのサーバーは読めません。",
      "Send your own files with OmniBeam: free, no app": "OmniBeamで自分のファイルも送れます:無料、アプリ不要",
      "{n} files · {size}": "{n}件のファイル · {size}",
      "1 file · {size}": "1件のファイル · {size}",
      "Available for {time}.": "あと{time}利用できます。",
      "This link works for one download only.": "このリンクは1回だけダウンロードできます。",
      "Downloading… {pct}%": "ダウンロード中… {pct}%",
      "Done. Tap a file to save it.": "完了。ファイルをタップして保存してください。",
      "Save": "保存",
      "This link has expired or was deleted.": "このリンクは期限切れか、削除されました。",
      "This link is incomplete. Copy the whole link, including the part after #.": "このリンクは不完全です。#以降も含めてリンク全体をコピーしてください。",
      "Someone is already downloading these files, or the one download was used.": "誰かがすでにこのファイルをダウンロード中か、1回分のダウンロードが使われました。",
      "Download failed. Check the connection and try again.": "ダウンロードに失敗しました。接続を確認してもう一度お試しください。",
      "{n} h": "{n}時間",
      "{n} min": "{n}分",
    },
    zh: {
      "A secret note for you": "给你的秘密便签",
      "End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can't read it.": "端到端加密：便签在此设备上解密。OmniBeam 服务器无法读取。",
      "This note was already read, or someone is reading it now.": "这条便签已经被读过，或者有人正在读。",
      "This note can be read once. When you open it, it is deleted from the server.": "这条便签只能读一次。打开后它会从服务器删除。",
      "Show the note": "显示便签",
      "Copy": "复制",
      "Copied": "已复制",
      "The note is now deleted from the server and won't open again. Copy it if you need it.": "便签已从服务器删除，不能再次打开。如有需要请复制下来。",
      "This link needs a PIN. Ask the person who sent it.": "此链接需要 PIN。请向发送者索取。",
      "Open": "打开",
      "The PIN has 4 to 8 digits.": "PIN 为 4 到 8 位数字。",
      "Wrong PIN. {n} tries left.": "PIN 错误。还剩 {n} 次机会。",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "PIN 错误次数过多：此链接已锁定。请向发送者索取新链接。",
      "Downloads left: {n} of {max}.": "剩余下载次数：{n}/{max}。",
      "Open OmniBeam": "打开 OmniBeam",
      "Files shared with you": "分享给你的文件",
      "Loading…": "正在加载…",
      "Download": "下载",
      "End-to-end encrypted: the files are decrypted on this device. The OmniBeam server can't read them.": "端到端加密：文件在此设备上解密。OmniBeam 服务器无法读取。",
      "Send your own files with OmniBeam: free, no app": "用 OmniBeam 发送你自己的文件：免费，无需应用",
      "{n} files · {size}": "{n} 个文件 · {size}",
      "1 file · {size}": "1 个文件 · {size}",
      "Available for {time}.": "还可下载 {time}。",
      "This link works for one download only.": "此链接只能下载一次。",
      "Downloading… {pct}%": "正在下载… {pct}%",
      "Done. Tap a file to save it.": "完成。点按文件即可保存。",
      "Save": "保存",
      "This link has expired or was deleted.": "此链接已过期或已被删除。",
      "This link is incomplete. Copy the whole link, including the part after #.": "此链接不完整。请复制完整链接，包括 # 后面的部分。",
      "Someone is already downloading these files, or the one download was used.": "有人正在下载这些文件，或者唯一的一次下载已被使用。",
      "Download failed. Check the connection and try again.": "下载失败。请检查连接后重试。",
      "{n} h": "{n} 小时",
      "{n} min": "{n} 分钟",
    },
    ko: {
      "A secret note for you": "나에게 온 비밀 메모",
      "End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can't read it.": "종단 간 암호화: 메모는 이 기기에서 복호화됩니다. OmniBeam 서버는 읽을 수 없습니다.",
      "This note was already read, or someone is reading it now.": "이 메모는 이미 읽혔거나 지금 누군가 읽고 있습니다.",
      "This note can be read once. When you open it, it is deleted from the server.": "이 메모는 한 번만 읽을 수 있습니다. 열면 서버에서 삭제됩니다.",
      "Show the note": "메모 보기",
      "Copy": "복사",
      "Copied": "복사됨",
      "The note is now deleted from the server and won't open again. Copy it if you need it.": "메모가 서버에서 삭제되어 다시 열리지 않습니다. 필요하면 복사해 두세요.",
      "This link needs a PIN. Ask the person who sent it.": "이 링크에는 PIN이 필요합니다. 보낸 사람에게 물어보세요.",
      "Open": "열기",
      "The PIN has 4 to 8 digits.": "PIN은 4~8자리 숫자입니다.",
      "Wrong PIN. {n} tries left.": "PIN이 틀렸습니다. {n}번 남았습니다.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "잘못된 PIN 입력이 너무 많아 링크가 잠겼습니다. 보낸 사람에게 새 링크를 요청하세요.",
      "Downloads left: {n} of {max}.": "남은 다운로드: {max}회 중 {n}회.",
      "Open OmniBeam": "OmniBeam 열기",
      "Files shared with you": "나에게 공유된 파일",
      "Loading…": "불러오는 중…",
      "Download": "다운로드",
      "End-to-end encrypted: the files are decrypted on this device. The OmniBeam server can't read them.": "종단 간 암호화: 파일은 이 기기에서 복호화됩니다. OmniBeam 서버는 읽을 수 없습니다.",
      "Send your own files with OmniBeam: free, no app": "OmniBeam으로 내 파일도 보내세요: 무료, 앱 필요 없음",
      "{n} files · {size}": "파일 {n}개 · {size}",
      "1 file · {size}": "파일 1개 · {size}",
      "Available for {time}.": "{time} 동안 받을 수 있습니다.",
      "This link works for one download only.": "이 링크는 한 번만 다운로드할 수 있습니다.",
      "Downloading… {pct}%": "다운로드 중… {pct}%",
      "Done. Tap a file to save it.": "완료. 파일을 탭해 저장하세요.",
      "Save": "저장",
      "This link has expired or was deleted.": "이 링크는 만료되었거나 삭제되었습니다.",
      "This link is incomplete. Copy the whole link, including the part after #.": "이 링크는 완전하지 않습니다. # 뒤 부분까지 링크 전체를 복사하세요.",
      "Someone is already downloading these files, or the one download was used.": "누군가 이미 이 파일을 내려받고 있거나, 한 번뿐인 다운로드가 이미 사용되었습니다.",
      "Download failed. Check the connection and try again.": "다운로드에 실패했습니다. 연결을 확인하고 다시 시도하세요.",
      "{n} h": "{n}시간",
      "{n} min": "{n}분",
    },
    it: {
      "A secret note for you": "Una nota segreta per te",
      "End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can't read it.": "Crittografia end-to-end: la nota viene decrittata su questo dispositivo. Il server di OmniBeam non può leggerla.",
      "This note was already read, or someone is reading it now.": "Questa nota è già stata letta, oppure qualcuno la sta leggendo ora.",
      "This note can be read once. When you open it, it is deleted from the server.": "Questa nota si può leggere una sola volta. Quando la apri, viene eliminata dal server.",
      "Show the note": "Mostra la nota",
      "Copy": "Copia",
      "Copied": "Copiato",
      "The note is now deleted from the server and won't open again. Copy it if you need it.": "La nota ora è eliminata dal server e non si aprirà più. Copiala se ti serve.",
      "This link needs a PIN. Ask the person who sent it.": "Questo link richiede un PIN. Chiedilo a chi te l'ha inviato.",
      "Open": "Apri",
      "The PIN has 4 to 8 digits.": "Il PIN ha da 4 a 8 cifre.",
      "Wrong PIN. {n} tries left.": "PIN errato. Tentativi rimasti: {n}.",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "Troppi PIN errati: questo link è bloccato. Chiedi al mittente un nuovo link.",
      "Downloads left: {n} of {max}.": "Download rimasti: {n} di {max}.",
      "Open OmniBeam": "Apri OmniBeam",
      "Files shared with you": "File condivisi con te",
      "Loading…": "Caricamento…",
      "Download": "Scarica",
      "End-to-end encrypted: the files are decrypted on this device. The OmniBeam server can't read them.": "Crittografia end-to-end: i file vengono decrittati su questo dispositivo. Il server di OmniBeam non può leggerli.",
      "Send your own files with OmniBeam: free, no app": "Invia i tuoi file con OmniBeam: gratis, senza app",
      "{n} files · {size}": "{n} file · {size}",
      "1 file · {size}": "1 file · {size}",
      "Available for {time}.": "Disponibile per {time}.",
      "This link works for one download only.": "Questo link funziona per un solo download.",
      "Downloading… {pct}%": "Download… {pct}%",
      "Done. Tap a file to save it.": "Fatto. Tocca un file per salvarlo.",
      "Save": "Salva",
      "This link has expired or was deleted.": "Questo link è scaduto o è stato eliminato.",
      "This link is incomplete. Copy the whole link, including the part after #.": "Questo link è incompleto. Copia tutto il link, compresa la parte dopo #.",
      "Someone is already downloading these files, or the one download was used.": "Qualcuno sta già scaricando questi file, oppure l'unico download è già stato usato.",
      "Download failed. Check the connection and try again.": "Download non riuscito. Controlla la connessione e riprova.",
      "{n} h": "{n} h",
      "{n} min": "{n} min",
    },
    ur: {
      "A secret note for you": "آپ کے لیے ایک خفیہ نوٹ",
      "End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can't read it.": "اینڈ ٹو اینڈ انکرپٹڈ: نوٹ اسی ڈیوائس پر کھولا جاتا ہے۔ OmniBeam سرور اسے پڑھ نہیں سکتا۔",
      "This note was already read, or someone is reading it now.": "یہ نوٹ پہلے ہی پڑھا جا چکا ہے، یا کوئی ابھی اسے پڑھ رہا ہے۔",
      "This note can be read once. When you open it, it is deleted from the server.": "یہ نوٹ ایک بار پڑھا جا سکتا ہے۔ کھولنے پر یہ سرور سے حذف ہو جاتا ہے۔",
      "Show the note": "نوٹ دکھائیں",
      "Copy": "کاپی کریں",
      "Copied": "کاپی ہو گیا",
      "The note is now deleted from the server and won't open again. Copy it if you need it.": "نوٹ اب سرور سے حذف ہو چکا ہے اور دوبارہ نہیں کھلے گا۔ ضرورت ہو تو اسے کاپی کر لیں۔",
      "This link needs a PIN. Ask the person who sent it.": "اس لنک کے لیے PIN چاہیے۔ بھیجنے والے سے پوچھیں۔",
      "Open": "کھولیں",
      "The PIN has 4 to 8 digits.": "PIN میں 4 سے 8 ہندسے ہوتے ہیں۔",
      "Wrong PIN. {n} tries left.": "غلط PIN۔ {n} کوششیں باقی ہیں۔",
      "Too many wrong PINs: this link is locked. Ask the sender for a new link.": "بہت بار غلط PIN: یہ لنک لاک ہو گیا ہے۔ بھیجنے والے سے نیا لنک مانگیں۔",
      "Downloads left: {n} of {max}.": "باقی ڈاؤن لوڈز: {max} میں سے {n}۔",
      "Open OmniBeam": "OmniBeam کھولیں",
      "Files shared with you": "آپ کے ساتھ شیئر کی گئی فائلیں",
      "Loading…": "لوڈ ہو رہا ہے…",
      "Download": "ڈاؤن لوڈ کریں",
      "End-to-end encrypted: the files are decrypted on this device. The OmniBeam server can't read them.": "اینڈ ٹو اینڈ انکرپٹڈ: فائلیں اسی ڈیوائس پر کھولی جاتی ہیں۔ OmniBeam سرور انہیں پڑھ نہیں سکتا۔",
      "Send your own files with OmniBeam: free, no app": "OmniBeam سے اپنی فائلیں بھیجیں: مفت، بغیر ایپ",
      "{n} files · {size}": "{n} فائلیں · {size}",
      "1 file · {size}": "1 فائل · {size}",
      "Available for {time}.": "{time} تک دستیاب۔",
      "This link works for one download only.": "یہ لنک صرف ایک ڈاؤن لوڈ کے لیے ہے۔",
      "Downloading… {pct}%": "ڈاؤن لوڈ ہو رہا ہے… {pct}%",
      "Done. Tap a file to save it.": "ہو گیا۔ محفوظ کرنے کے لیے کسی فائل پر ٹیپ کریں۔",
      "Save": "محفوظ کریں",
      "This link has expired or was deleted.": "یہ لنک ختم ہو گیا ہے یا حذف کر دیا گیا ہے۔",
      "This link is incomplete. Copy the whole link, including the part after #.": "یہ لنک نامکمل ہے۔ # کے بعد والے حصے سمیت پورا لنک کاپی کریں۔",
      "Someone is already downloading these files, or the one download was used.": "کوئی پہلے ہی یہ فائلیں ڈاؤن لوڈ کر رہا ہے، یا واحد ڈاؤن لوڈ استعمال ہو چکا ہے۔",
      "Download failed. Check the connection and try again.": "ڈاؤن لوڈ ناکام ہو گیا۔ کنکشن چیک کر کے دوبارہ کوشش کریں۔",
      "{n} h": "{n} گھنٹے",
      "{n} min": "{n} منٹ",
    },
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
    document.title = `${t('Files shared with you')} | OmniBeam`;
    const home = `/${lang}/`;
    for (const a of document.querySelectorAll('a[href="/"]')) a.href = home;
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
  const ivFor = (n, meta = false) => {
    const v = new Uint8Array(12);
    v[0] = meta ? 1 : 0;
    new DataView(v.buffer).setUint32(8, n);
    return v;
  };

  const id = location.pathname.split('/').pop();
  const keyText = location.hash.slice(1);
  let key, info, files;
  let note = false; // a secret note (drop.js): text shown here once, then gone from the server
  let pinHeader = {}; // { 'X-Drop-Pin': proof } once the right PIN was typed (links with a PIN)
  const b64u = (buf) => {
    let s = '';
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  // Same as pinProof in drop.js: the server only ever sees this, never the PIN
  const pinProof = async (pin) => b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`omnibeam-pin:${pin}:${keyText}`)));
  // Ask for the PIN; resolves with the answer to the first request that it unlocked
  function askPin(first) {
    const form = $('#drop-pin');
    const input = $('#drop-pin-input');
    form.hidden = false;
    status(first.status === 423 ? t('Too many wrong PINs: this link is locked. Ask the sender for a new link.') : '');
    if (first.status === 423) { form.hidden = true; return Promise.resolve(null); }
    input.focus();
    return new Promise((resolve) => {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const pin = input.value.replace(/\D/g, '');
        if (pin.length < 4) return status(t('The PIN has 4 to 8 digits.'));
        const header = { 'X-Drop-Pin': await pinProof(pin) };
        const r = await fetch(`/api/drop/${id}`, { cache: 'no-store', headers: header }).catch(() => null);
        if (!r) return status(t('Download failed. Check the connection and try again.'));
        if (r.ok) { pinHeader = header; form.hidden = true; return resolve(r); }
        const body = await r.json().catch(() => ({}));
        if (r.status === 423) { form.hidden = true; status(t('Too many wrong PINs: this link is locked. Ask the sender for a new link.')); return resolve(null); }
        if (r.status === 403) { input.value = ''; input.focus(); return status(t('Wrong PIN. {n} tries left.', { n: body.left ?? '?' })); }
        status(t('This link has expired or was deleted.'));
        form.hidden = true;
        resolve(null);
      };
    });
  }

  async function init() {
    if (!/^[A-Za-z0-9_-]{20,24}$/.test(keyText) || !window.crypto?.subtle) return status(t('This link is incomplete. Copy the whole link, including the part after #.'));
    try {
      key = await crypto.subtle.importKey('raw', fromB64u(keyText), 'AES-GCM', false, ['decrypt']);
    } catch {
      return status(t('This link is incomplete. Copy the whole link, including the part after #.'));
    }
    let r = await fetch(`/api/drop/${id}`, { cache: 'no-store' }).catch(() => null);
    if (r && (r.status === 401 || r.status === 423)) {
      r = await askPin(r);
      if (!r) return;
    }
    if (!r || !r.ok) return status(r ? t('This link has expired or was deleted.') : t('Download failed. Check the connection and try again.'));
    info = await r.json();
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivFor(0, true) }, key, fromB64u(info.meta));
      const meta = JSON.parse(new TextDecoder().decode(plain));
      files = meta.files;
      note = meta.note === 1;
    } catch {
      return status(t('This link is incomplete. Copy the whole link, including the part after #.'));
    }
    const left = info.expires - Date.now();
    const time = left >= 3600000 ? t('{n} h', { n: Math.round(left / 3600000) }) : t('{n} min', { n: Math.max(1, Math.round(left / 60000)) });
    if (note) {
      // Nothing is fetched until "Show the note", so link previews in chat apps can't use it up
      $('h1').textContent = t('A secret note for you');
      document.title = `${t('A secret note for you')} | OmniBeam`;
      $('.drop-note').textContent = t('End-to-end encrypted: the note is decrypted on this device. The OmniBeam server can\'t read it.');
      if (info.left === 0) return status(t('This note was already read, or someone is reading it now.'));
      status(`${t('This note can be read once. When you open it, it is deleted from the server.')} ${t('Available for {time}.', { time })}`);
      $('#drop-get').textContent = t('Show the note');
      $('#drop-get').hidden = false;
      return;
    }
    const list = $('#drop-files');
    for (const f of files) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="n"></span><span class="s"></span>';
      li.querySelector('.n').textContent = f.name;
      li.querySelector('.s').textContent = formatSize(f.size);
      list.appendChild(li);
    }
    status(`${files.length > 1 ? t('{n} files · {size}', { n: files.length, size: formatSize(info.size) }) : t('1 file · {size}', { size: formatSize(info.size) })}. ${t('Available for {time}.', { time })}${info.once ? ' ' + t('This link works for one download only.') : info.max ? ' ' + t('Downloads left: {n} of {max}.', { n: info.left, max: info.max }) : ''}`);
    if (info.max && info.left === 0) return status(t('Someone is already downloading these files, or the one download was used.'));
    $('#drop-get').hidden = false;
  }

  async function download() {
    const button = $('#drop-get');
    button.hidden = true;
    const bar = $('#drop-bar');
    bar.hidden = false;
    const setBar = (frac) => {
      bar.firstElementChild.style.width = `${(frac * 100).toFixed(1)}%`;
      status(t('Downloading… {pct}%', { pct: Math.floor(frac * 100) }));
    };
    setBar(0);
    try {
      const r = await fetch(`/api/drop/${id}/data`, { cache: 'no-store', headers: pinHeader });
      if (r.status === 410) throw new Error(note ? t('This note was already read, or someone is reading it now.') : t('Someone is already downloading these files, or the one download was used.'));
      if (r.status === 404) throw new Error(t('This link has expired or was deleted.'));
      if (!r.ok || !r.body) throw new Error('');
      // Decrypt part by part as the data arrives
      const reader = r.body.getReader();
      const out = [];
      let pending = new Uint8Array(0);
      let n = 0;
      let done = 0;
      const partLen = (k) => Math.min(info.part, info.size - k * info.part) + 16;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (value) {
          const merged = new Uint8Array(pending.length + value.length);
          merged.set(pending);
          merged.set(value, pending.length);
          pending = merged;
          while (n * info.part < info.size && pending.length >= partLen(n)) {
            const len = partLen(n);
            out.push(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivFor(n) }, key, pending.subarray(0, len))));
            pending = pending.slice(len);
            done += len - 16;
            n++;
          }
          setBar((done + pending.length) / info.size);
        }
        if (end) break;
      }
      if (done !== info.size) throw new Error('');
      const all = new Blob(out);
      out.length = 0;
      if (note) {
        const text = await all.text();
        const box = document.createElement('div');
        box.className = 'secret-note';
        box.innerHTML = '<pre></pre><p class="cta"><button type="button" class="open-app"></button></p>';
        box.querySelector('pre').textContent = text;
        const copy = box.querySelector('button');
        copy.textContent = t('Copy');
        copy.onclick = () => navigator.clipboard?.writeText(text).then(() => { copy.textContent = t('Copied'); }, () => {});
        $('#drop-files').replaceWith(box);
        bar.hidden = true;
        status(t('The note is now deleted from the server and won\'t open again. Copy it if you need it.'));
        return;
      }
      let offset = 0;
      const list = $('#drop-files');
      list.innerHTML = '';
      const saveButtons = [];
      for (const f of files) {
        const blob = new Blob([all.slice(offset, offset + f.size)], { type: f.type || 'application/octet-stream' });
        offset += f.size;
        const url = URL.createObjectURL(blob);
        const li = document.createElement('li');
        li.innerHTML = '<span class="n"></span><a class="save"></a>';
        li.querySelector('.n').textContent = `${f.name} · ${formatSize(f.size)}`;
        const a = li.querySelector('a');
        a.href = url;
        a.download = f.name;
        a.textContent = t('Save');
        saveButtons.push(a);
        list.appendChild(li);
      }
      bar.hidden = true;
      status(t('Done. Tap a file to save it.'));
      if (saveButtons.length === 1) saveButtons[0].click();
    } catch (err) {
      bar.hidden = true;
      window.omniReport?.('link', 'Download failed: ' + (err.message || err.name || 'unknown'));
      status(err.message || t('Download failed. Check the connection and try again.'));
      if (!err.message) button.hidden = false;
    }
  }

  $('#drop-get').onclick = download;
  init().catch((err) => {
    window.omniReport?.('link', 'Could not open the link: ' + ((err && err.message) || 'unknown'));
    status(t('Download failed. Check the connection and try again.'));
  });
})();
