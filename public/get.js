// OmniBeam download page for files shared by link (/d/<id>#<key>). See drop.js for the format.
// The key comes from the part of the address after #, which never reaches the server. Nothing is downloaded until
// the visitor presses Download, so link previews in chat apps don't use up a one-time link.
// The page shows a row per file (icon or small picture, size, type), when it was shared and how many times it was
// opened and downloaded. On a link without a download limit, one file can be fetched on its own (Range, not counted)
// for a preview or a small picture, and the download fetches several parts at once (see fastDownload); after the
// download every file can be previewed, saved, or saved all as one ZIP. A shared folder (meta.folder) keeps its
// folders: each row shows where the file is in it, and the ZIP has the same folders inside, named after the folder.
'use strict';
(function () {
  // Keep the phone's screen on while this page uploads or downloads: a phone that locks its screen stops it. The Wake
  // Lock API where there is one (asked for again when the page is back in front or the phone let it go), and on
  // iPhones, or without it, a tiny muted video playing in a corner of the page, as on the main page (app.js:
  // KeepAwakeVideo). Awake.on() when the work starts, Awake.off() when it ends.
  const Awake = (() => {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let n = 0;
    let lock = null;
    let asking = false;
    let video = null;
    function play() {
      if (!video) {
        video = document.createElement('video');
        video.muted = video.loop = video.playsInline = true;
        for (const a of ['muted', 'playsinline', 'loop']) video.setAttribute(a, '');
        video.setAttribute('aria-hidden', 'true');
        video.tabIndex = -1;
        video.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:.01;pointer-events:none;z-index:-1';
        video.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAK4bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkR0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAHgbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAD6AAAB9BVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABi21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUtzdGJsAAAAg3N0c2QAAAAAAAAAAQAAAHNhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAHWF2Y0MBQsAK/+EABmdCwAraeQEABGjOPIAAAAAYc3R0cwAAAAAAAAABAAAAFAAAAGQAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAFAAAAAEAAABkc3RzegAAAAAAAAAAAAAAFAAAAYoAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAAFHN0Y28AAAAAAAAAAQAAAuAAAAIqbWRhdAAAAYZliISg0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAAAAAEQZoilAAAAARBmkKUAAAABEGaYpQAAAAEQZqClAAAAARBmqKUAAAABEGawpQAAAAEQZrilAAAAARBmwKUAAAABEGbIpQAAAAEQZtClAAAAARBm2KUAAAABEGbgpQAAAAEQZuilAAAAARBm8KUAAAABEGb4pQAAAAEQZoClAAAAARBmiKUAAAABEGaQpQAAAAEQZpilA==';
      }
      if (!video.isConnected) document.body.appendChild(video);
      if (video.paused) video.play().catch(() => {});
    }
    async function grab() {
      if (!n || document.visibilityState !== 'visible') return;
      if (ios || !navigator.wakeLock) play(); // first, while still in the tap that started it
      if (lock || asking || !navigator.wakeLock) return;
      asking = true;
      try {
        const got = await navigator.wakeLock.request('screen');
        got.addEventListener('release', () => { if (lock === got) lock = null; });
        lock = got;
        if (!n) { lock = null; got.release().catch(() => {}); }
      } catch {
        if (n) play();
      } finally {
        asking = false;
      }
    }
    document.addEventListener('visibilitychange', grab);
    setInterval(() => { if (n && !lock) grab(); }, 5000);
    return {
      on() { n++; grab(); },
      off() {
        n = Math.max(0, n - 1);
        if (n) return;
        const had = lock;
        lock = null;
        had?.release().catch(() => {});
        video?.pause();
      },
    };
  })();
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
  // Added with the file page (previews, ZIP, counts, share buttons; 2026-11-24)
  const MORE = {
    ar: {
      'This link needs a PIN or password. Ask the person who sent it.': 'هذا الرابط يحتاج إلى رمز PIN أو كلمة مرور. اطلبها من الشخص الذي أرسله.',
      'The PIN or password has 4 to 32 characters.': 'رمز PIN أو كلمة المرور من 4 إلى 32 حرفًا.',
      'Shared {date}': 'تمت المشاركة {date}', 'Downloads: {n}': 'التنزيلات: {n}', 'Views: {n}': 'المشاهدات: {n}',
      'Preview': 'معاينة', 'Close': 'إغلاق', 'Save all as ZIP': 'حفظ الكل كملف ZIP', 'Making the ZIP…': 'جارٍ إنشاء ملف ZIP…',
      'No preview for this file. Download it to open it.': 'لا توجد معاينة لهذا الملف. نزّله لفتحه.', 'Loading preview…': 'جارٍ تحميل المعاينة…',
      'Copy link': 'نسخ الرابط', 'Link copied': 'تم نسخ الرابط', 'Share': 'مشاركة',
      'No sign-up. End-to-end encrypted. Any device.': 'دون تسجيل. مشفّر من طرف إلى طرف. على أي جهاز.',
      'Done. Save all as ZIP, or tap a file to save it.': 'تم. احفظ الكل كملف ZIP، أو اضغط على ملف لحفظه.',
    },
    fr: {
      'This link needs a PIN or password. Ask the person who sent it.': 'Ce lien demande un code PIN ou un mot de passe. Demandez-le à la personne qui l\'a envoyé.',
      'The PIN or password has 4 to 32 characters.': 'Le code PIN ou le mot de passe contient 4 à 32 caractères.',
      'Shared {date}': 'Partagé le {date}', 'Downloads: {n}': 'Téléchargements : {n}', 'Views: {n}': 'Vues : {n}',
      'Preview': 'Aperçu', 'Close': 'Fermer', 'Save all as ZIP': 'Tout enregistrer en ZIP', 'Making the ZIP…': 'Création du ZIP…',
      'No preview for this file. Download it to open it.': 'Pas d\'aperçu pour ce fichier. Téléchargez-le pour l\'ouvrir.', 'Loading preview…': 'Chargement de l\'aperçu…',
      'Copy link': 'Copier le lien', 'Link copied': 'Lien copié', 'Share': 'Partager',
      'No sign-up. End-to-end encrypted. Any device.': 'Sans inscription. Chiffré de bout en bout. Sur tout appareil.',
      'Done. Save all as ZIP, or tap a file to save it.': 'Terminé. Enregistrez tout en ZIP, ou touchez un fichier pour l\'enregistrer.',
    },
    es: {
      'This link needs a PIN or password. Ask the person who sent it.': 'Este enlace necesita un PIN o una contraseña. Pídesela a quien lo envió.',
      'The PIN or password has 4 to 32 characters.': 'El PIN o la contraseña tiene de 4 a 32 caracteres.',
      'Shared {date}': 'Compartido el {date}', 'Downloads: {n}': 'Descargas: {n}', 'Views: {n}': 'Visitas: {n}',
      'Preview': 'Vista previa', 'Close': 'Cerrar', 'Save all as ZIP': 'Guardar todo como ZIP', 'Making the ZIP…': 'Creando el ZIP…',
      'No preview for this file. Download it to open it.': 'No hay vista previa de este archivo. Descárgalo para abrirlo.', 'Loading preview…': 'Cargando vista previa…',
      'Copy link': 'Copiar enlace', 'Link copied': 'Enlace copiado', 'Share': 'Compartir',
      'No sign-up. End-to-end encrypted. Any device.': 'Sin registro. Cifrado de extremo a extremo. En cualquier dispositivo.',
      'Done. Save all as ZIP, or tap a file to save it.': 'Listo. Guarda todo como ZIP o toca un archivo para guardarlo.',
    },
    tr: {
      'This link needs a PIN or password. Ask the person who sent it.': 'Bu bağlantı bir PIN veya parola istiyor. Gönderen kişiye sorun.',
      'The PIN or password has 4 to 32 characters.': 'PIN veya parola 4 ile 32 karakterdir.',
      'Shared {date}': 'Paylaşıldı: {date}', 'Downloads: {n}': 'İndirme: {n}', 'Views: {n}': 'Görüntülenme: {n}',
      'Preview': 'Önizleme', 'Close': 'Kapat', 'Save all as ZIP': 'Tümünü ZIP olarak kaydet', 'Making the ZIP…': 'ZIP hazırlanıyor…',
      'No preview for this file. Download it to open it.': 'Bu dosya için önizleme yok. Açmak için indirin.', 'Loading preview…': 'Önizleme yükleniyor…',
      'Copy link': 'Bağlantıyı kopyala', 'Link copied': 'Bağlantı kopyalandı', 'Share': 'Paylaş',
      'No sign-up. End-to-end encrypted. Any device.': 'Kayıt yok. Uçtan uca şifreli. Her cihazda.',
      'Done. Save all as ZIP, or tap a file to save it.': 'Bitti. Tümünü ZIP olarak kaydedin veya kaydetmek için bir dosyaya dokunun.',
    },
    de: {
      'This link needs a PIN or password. Ask the person who sent it.': 'Dieser Link braucht eine PIN oder ein Passwort. Frag die Person, die ihn geschickt hat.',
      'The PIN or password has 4 to 32 characters.': 'Die PIN oder das Passwort hat 4 bis 32 Zeichen.',
      'Shared {date}': 'Geteilt am {date}', 'Downloads: {n}': 'Downloads: {n}', 'Views: {n}': 'Aufrufe: {n}',
      'Preview': 'Vorschau', 'Close': 'Schließen', 'Save all as ZIP': 'Alle als ZIP speichern', 'Making the ZIP…': 'ZIP wird erstellt…',
      'No preview for this file. Download it to open it.': 'Keine Vorschau für diese Datei. Lade sie herunter, um sie zu öffnen.', 'Loading preview…': 'Vorschau wird geladen…',
      'Copy link': 'Link kopieren', 'Link copied': 'Link kopiert', 'Share': 'Teilen',
      'No sign-up. End-to-end encrypted. Any device.': 'Ohne Anmeldung. Ende-zu-Ende-verschlüsselt. Auf jedem Gerät.',
      'Done. Save all as ZIP, or tap a file to save it.': 'Fertig. Speichere alle als ZIP oder tippe auf eine Datei, um sie zu speichern.',
    },
    pt: {
      'This link needs a PIN or password. Ask the person who sent it.': 'Este link precisa de um PIN ou senha. Peça à pessoa que o enviou.',
      'The PIN or password has 4 to 32 characters.': 'O PIN ou a senha tem de 4 a 32 caracteres.',
      'Shared {date}': 'Compartilhado em {date}', 'Downloads: {n}': 'Downloads: {n}', 'Views: {n}': 'Visualizações: {n}',
      'Preview': 'Pré-visualizar', 'Close': 'Fechar', 'Save all as ZIP': 'Salvar tudo em ZIP', 'Making the ZIP…': 'Criando o ZIP…',
      'No preview for this file. Download it to open it.': 'Sem pré-visualização para este arquivo. Baixe-o para abrir.', 'Loading preview…': 'Carregando pré-visualização…',
      'Copy link': 'Copiar link', 'Link copied': 'Link copiado', 'Share': 'Compartilhar',
      'No sign-up. End-to-end encrypted. Any device.': 'Sem cadastro. Criptografia de ponta a ponta. Em qualquer aparelho.',
      'Done. Save all as ZIP, or tap a file to save it.': 'Pronto. Salve tudo em ZIP ou toque em um arquivo para salvá-lo.',
    },
    hi: {
      'This link needs a PIN or password. Ask the person who sent it.': 'इस लिंक के लिए PIN या पासवर्ड चाहिए। भेजने वाले से पूछें।',
      'The PIN or password has 4 to 32 characters.': 'PIN या पासवर्ड 4 से 32 अक्षरों का होता है।',
      'Shared {date}': '{date} को शेयर किया', 'Downloads: {n}': 'डाउनलोड: {n}', 'Views: {n}': 'व्यू: {n}',
      'Preview': 'प्रीव्यू', 'Close': 'बंद करें', 'Save all as ZIP': 'सब ZIP में सेव करें', 'Making the ZIP…': 'ZIP बन रहा है…',
      'No preview for this file. Download it to open it.': 'इस फ़ाइल का प्रीव्यू नहीं है। खोलने के लिए डाउनलोड करें।', 'Loading preview…': 'प्रीव्यू लोड हो रहा है…',
      'Copy link': 'लिंक कॉपी करें', 'Link copied': 'लिंक कॉपी हुआ', 'Share': 'शेयर करें',
      'No sign-up. End-to-end encrypted. Any device.': 'साइन-अप नहीं। एंड-टू-एंड एन्क्रिप्टेड। किसी भी डिवाइस पर।',
      'Done. Save all as ZIP, or tap a file to save it.': 'हो गया। सब ZIP में सेव करें, या सेव करने के लिए किसी फ़ाइल पर टैप करें।',
    },
    id: {
      'This link needs a PIN or password. Ask the person who sent it.': 'Tautan ini memerlukan PIN atau kata sandi. Tanyakan kepada pengirimnya.',
      'The PIN or password has 4 to 32 characters.': 'PIN atau kata sandi terdiri dari 4 sampai 32 karakter.',
      'Shared {date}': 'Dibagikan {date}', 'Downloads: {n}': 'Unduhan: {n}', 'Views: {n}': 'Dilihat: {n}',
      'Preview': 'Pratinjau', 'Close': 'Tutup', 'Save all as ZIP': 'Simpan semua sebagai ZIP', 'Making the ZIP…': 'Membuat ZIP…',
      'No preview for this file. Download it to open it.': 'Tidak ada pratinjau untuk file ini. Unduh untuk membukanya.', 'Loading preview…': 'Memuat pratinjau…',
      'Copy link': 'Salin tautan', 'Link copied': 'Tautan disalin', 'Share': 'Bagikan',
      'No sign-up. End-to-end encrypted. Any device.': 'Tanpa daftar. Terenkripsi end-to-end. Di perangkat apa pun.',
      'Done. Save all as ZIP, or tap a file to save it.': 'Selesai. Simpan semua sebagai ZIP, atau ketuk file untuk menyimpannya.',
    },
    ru: {
      'This link needs a PIN or password. Ask the person who sent it.': 'Для этой ссылки нужен PIN-код или пароль. Спросите у отправителя.',
      'The PIN or password has 4 to 32 characters.': 'PIN-код или пароль — от 4 до 32 символов.',
      'Shared {date}': 'Отправлено {date}', 'Downloads: {n}': 'Скачиваний: {n}', 'Views: {n}': 'Просмотров: {n}',
      'Preview': 'Просмотр', 'Close': 'Закрыть', 'Save all as ZIP': 'Сохранить всё в ZIP', 'Making the ZIP…': 'Создаём ZIP…',
      'No preview for this file. Download it to open it.': 'Для этого файла нет просмотра. Скачайте его, чтобы открыть.', 'Loading preview…': 'Загружаем просмотр…',
      'Copy link': 'Копировать ссылку', 'Link copied': 'Ссылка скопирована', 'Share': 'Поделиться',
      'No sign-up. End-to-end encrypted. Any device.': 'Без регистрации. Сквозное шифрование. На любом устройстве.',
      'Done. Save all as ZIP, or tap a file to save it.': 'Готово. Сохраните всё в ZIP или нажмите на файл, чтобы сохранить его.',
    },
    ja: {
      'This link needs a PIN or password. Ask the person who sent it.': 'このリンクには PIN またはパスワードが必要です。送った人に聞いてください。',
      'The PIN or password has 4 to 32 characters.': 'PIN またはパスワードは 4〜32 文字です。',
      'Shared {date}': '{date} に共有', 'Downloads: {n}': 'ダウンロード: {n}', 'Views: {n}': '閲覧: {n}',
      'Preview': 'プレビュー', 'Close': '閉じる', 'Save all as ZIP': 'すべて ZIP で保存', 'Making the ZIP…': 'ZIP を作成中…',
      'No preview for this file. Download it to open it.': 'このファイルはプレビューできません。ダウンロードして開いてください。', 'Loading preview…': 'プレビューを読み込み中…',
      'Copy link': 'リンクをコピー', 'Link copied': 'リンクをコピーしました', 'Share': '共有',
      'No sign-up. End-to-end encrypted. Any device.': '登録不要。エンドツーエンド暗号化。どのデバイスでも。',
      'Done. Save all as ZIP, or tap a file to save it.': '完了。すべて ZIP で保存するか、ファイルをタップして保存してください。',
    },
    zh: {
      'This link needs a PIN or password. Ask the person who sent it.': '此链接需要 PIN 码或密码。请向发送者询问。',
      'The PIN or password has 4 to 32 characters.': 'PIN 码或密码为 4 到 32 个字符。',
      'Shared {date}': '分享于 {date}', 'Downloads: {n}': '下载：{n}', 'Views: {n}': '浏览：{n}',
      'Preview': '预览', 'Close': '关闭', 'Save all as ZIP': '全部保存为 ZIP', 'Making the ZIP…': '正在生成 ZIP…',
      'No preview for this file. Download it to open it.': '此文件无法预览。请下载后打开。', 'Loading preview…': '正在加载预览…',
      'Copy link': '复制链接', 'Link copied': '链接已复制', 'Share': '分享',
      'No sign-up. End-to-end encrypted. Any device.': '无需注册。端到端加密。任何设备可用。',
      'Done. Save all as ZIP, or tap a file to save it.': '完成。全部保存为 ZIP，或点按文件单独保存。',
    },
    ko: {
      'This link needs a PIN or password. Ask the person who sent it.': '이 링크에는 PIN 또는 비밀번호가 필요합니다. 보낸 사람에게 물어보세요.',
      'The PIN or password has 4 to 32 characters.': 'PIN 또는 비밀번호는 4~32자입니다.',
      'Shared {date}': '{date} 공유됨', 'Downloads: {n}': '다운로드: {n}', 'Views: {n}': '조회: {n}',
      'Preview': '미리 보기', 'Close': '닫기', 'Save all as ZIP': '모두 ZIP으로 저장', 'Making the ZIP…': 'ZIP 만드는 중…',
      'No preview for this file. Download it to open it.': '이 파일은 미리 볼 수 없습니다. 다운로드해서 여세요.', 'Loading preview…': '미리 보기 불러오는 중…',
      'Copy link': '링크 복사', 'Link copied': '링크 복사됨', 'Share': '공유',
      'No sign-up. End-to-end encrypted. Any device.': '가입 없음. 종단 간 암호화. 모든 기기에서.',
      'Done. Save all as ZIP, or tap a file to save it.': '완료. 모두 ZIP으로 저장하거나 파일을 탭해 저장하세요.',
    },
    it: {
      'This link needs a PIN or password. Ask the person who sent it.': 'Questo link richiede un PIN o una password. Chiedila a chi l\'ha inviato.',
      'The PIN or password has 4 to 32 characters.': 'Il PIN o la password ha da 4 a 32 caratteri.',
      'Shared {date}': 'Condiviso il {date}', 'Downloads: {n}': 'Download: {n}', 'Views: {n}': 'Visualizzazioni: {n}',
      'Preview': 'Anteprima', 'Close': 'Chiudi', 'Save all as ZIP': 'Salva tutto come ZIP', 'Making the ZIP…': 'Creazione dello ZIP…',
      'No preview for this file. Download it to open it.': 'Nessuna anteprima per questo file. Scaricalo per aprirlo.', 'Loading preview…': 'Caricamento anteprima…',
      'Copy link': 'Copia link', 'Link copied': 'Link copiato', 'Share': 'Condividi',
      'No sign-up. End-to-end encrypted. Any device.': 'Senza registrazione. Crittografia end-to-end. Su qualsiasi dispositivo.',
      'Done. Save all as ZIP, or tap a file to save it.': 'Fatto. Salva tutto come ZIP o tocca un file per salvarlo.',
    },
    ur: {
      'This link needs a PIN or password. Ask the person who sent it.': 'اس لنک کے لیے PIN یا پاس ورڈ چاہیے۔ بھیجنے والے سے پوچھیں۔',
      'The PIN or password has 4 to 32 characters.': 'PIN یا پاس ورڈ 4 سے 32 حروف کا ہوتا ہے۔',
      'Shared {date}': '{date} کو شیئر کیا گیا', 'Downloads: {n}': 'ڈاؤن لوڈ: {n}', 'Views: {n}': 'ویوز: {n}',
      'Preview': 'پیش نظارہ', 'Close': 'بند کریں', 'Save all as ZIP': 'سب ZIP میں محفوظ کریں', 'Making the ZIP…': 'ZIP بن رہی ہے…',
      'No preview for this file. Download it to open it.': 'اس فائل کا پیش نظارہ نہیں ہے۔ کھولنے کے لیے ڈاؤن لوڈ کریں۔', 'Loading preview…': 'پیش نظارہ لوڈ ہو رہا ہے…',
      'Copy link': 'لنک کاپی کریں', 'Link copied': 'لنک کاپی ہو گیا', 'Share': 'شیئر کریں',
      'No sign-up. End-to-end encrypted. Any device.': 'سائن اپ نہیں۔ اینڈ ٹو اینڈ انکرپٹڈ۔ کسی بھی ڈیوائس پر۔',
      'Done. Save all as ZIP, or tap a file to save it.': 'ہو گیا۔ سب ZIP میں محفوظ کریں، یا محفوظ کرنے کے لیے کسی فائل پر ٹیپ کریں۔',
    },
  };
  for (const [code, strings] of Object.entries(MORE)) Object.assign(TEXT[code], strings);
  // Added with fast downloads (several parts at once, resume, speed and time left; 2026-11-24)
  const FAST = {
    ar: {
      "{time} left": "{time} متبقية",
      "{n} s": "{n} ث",
      "Connection lost. Waiting for it to come back…": "انقطع الاتصال. بانتظار عودته…",
      "Resume download": "استئناف التنزيل",
      "The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.": "توقف التنزيل مؤقتًا لأن الاتصال انقطع. اضغط «استئناف التنزيل» للمتابعة من حيث توقف.",
    },
    fr: {
      "{time} left": "{time} restantes",
      "{n} s": "{n} s",
      "Connection lost. Waiting for it to come back…": "Connexion perdue. En attente de son retour…",
      "Resume download": "Reprendre le téléchargement",
      "The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.": "Le téléchargement est en pause : la connexion a été perdue. Touchez Reprendre le téléchargement pour continuer là où il s'est arrêté.",
    },
    es: {
      "{time} left": "quedan {time}",
      "{n} s": "{n} s",
      "Connection lost. Waiting for it to come back…": "Se perdió la conexión. Esperando a que vuelva…",
      "Resume download": "Reanudar descarga",
      "The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.": "La descarga está en pausa: se perdió la conexión. Toca Reanudar descarga para seguir donde se quedó.",
    },
    tr: {
      "{time} left": "{time} kaldı",
      "{n} s": "{n} sn",
      "Connection lost. Waiting for it to come back…": "Bağlantı koptu. Geri gelmesi bekleniyor…",
      "Resume download": "İndirmeyi sürdür",
      "The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.": "İndirme duraklatıldı: bağlantı koptu. Kaldığı yerden devam etmek için İndirmeyi sürdür'e dokunun.",
    },
    de: {
      "{time} left": "noch {time}",
      "{n} s": "{n} Sek.",
      "Connection lost. Waiting for it to come back…": "Verbindung verloren. Warte, bis sie zurück ist…",
      "Resume download": "Download fortsetzen",
      "The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.": "Der Download ist pausiert: Die Verbindung wurde unterbrochen. Tippe auf „Download fortsetzen“, um dort weiterzumachen, wo er aufgehört hat.",
    },
    pt: {
      "{time} left": "faltam {time}",
      "{n} s": "{n} s",
      "Connection lost. Waiting for it to come back…": "Conexão perdida. Aguardando ela voltar…",
      "Resume download": "Retomar download",
      "The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.": "O download foi pausado: a conexão caiu. Toque em Retomar download para continuar de onde parou.",
    },
    hi: {
      "{time} left": "{time} बाकी",
      "{n} s": "{n} सेकंड",
      "Connection lost. Waiting for it to come back…": "कनेक्शन टूट गया। उसके वापस आने का इंतज़ार…",
      "Resume download": "डाउनलोड फिर शुरू करें",
      "The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.": "डाउनलोड रुक गया: कनेक्शन टूट गया। जहाँ रुका था वहीं से जारी रखने के लिए \"डाउनलोड फिर शुरू करें\" पर टैप करें।",
    },
    id: {
      "{time} left": "sisa {time}",
      "{n} s": "{n} dtk",
      "Connection lost. Waiting for it to come back…": "Koneksi terputus. Menunggu tersambung lagi…",
      "Resume download": "Lanjutkan unduhan",
      "The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.": "Unduhan dijeda: koneksi terputus. Ketuk Lanjutkan unduhan untuk melanjutkan dari titik terakhir.",
    },
    ru: {
      "{time} left": "осталось {time}",
      "{n} s": "{n} с",
      "Connection lost. Waiting for it to come back…": "Связь потеряна. Ждём, когда она вернётся…",
      "Resume download": "Продолжить загрузку",
      "The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.": "Загрузка приостановлена: связь потеряна. Нажмите «Продолжить загрузку», чтобы продолжить с того же места.",
    },
    ja: {
      "{time} left": "残り {time}",
      "{n} s": "{n} 秒",
      "Connection lost. Waiting for it to come back…": "接続が切れました。復帰を待っています…",
      "Resume download": "ダウンロードを再開",
      "The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.": "接続が切れたため、ダウンロードを一時停止しました。「ダウンロードを再開」をタップすると、止まったところから続けます。",
    },
    zh: {
      "{time} left": "剩余 {time}",
      "{n} s": "{n} 秒",
      "Connection lost. Waiting for it to come back…": "连接已断开，正在等待恢复…",
      "Resume download": "继续下载",
      "The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.": "下载已暂停：连接已断开。点按“继续下载”，从中断处接着下载。",
    },
    ko: {
      "{time} left": "{time} 남음",
      "{n} s": "{n}초",
      "Connection lost. Waiting for it to come back…": "연결이 끊겼습니다. 다시 연결되기를 기다리는 중…",
      "Resume download": "다운로드 재개",
      "The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.": "연결이 끊겨 다운로드가 일시 중지되었습니다. 다운로드 재개를 탭하면 멈춘 곳부터 이어서 받습니다.",
    },
    it: {
      "{time} left": "{time} rimanenti",
      "{n} s": "{n} s",
      "Connection lost. Waiting for it to come back…": "Connessione persa. In attesa che torni…",
      "Resume download": "Riprendi download",
      "The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.": "Download in pausa: la connessione si è interrotta. Tocca Riprendi download per continuare da dove si era fermato.",
    },
    ur: {
      "{time} left": "{time} باقی",
      "{n} s": "{n} سیکنڈ",
      "Connection lost. Waiting for it to come back…": "کنکشن ٹوٹ گیا۔ واپس آنے کا انتظار ہے…",
      "Resume download": "ڈاؤن لوڈ دوبارہ شروع کریں",
      "The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.": "ڈاؤن لوڈ رک گیا: کنکشن ٹوٹ گیا۔ جہاں رکا تھا وہیں سے جاری رکھنے کے لیے \"ڈاؤن لوڈ دوبارہ شروع کریں\" پر ٹیپ کریں۔",
    },
  };
  for (const [code, strings] of Object.entries(FAST)) Object.assign(TEXT[code], strings);
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
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(navigator.userAgent);
  $('#drop-view-close').setAttribute('aria-label', t('Close'));

  const id = location.pathname.split('/').pop();
  const keyText = location.hash.slice(1);
  let key, info, files;
  let offsets = []; // where each file starts in the data (the files are one after the other)
  let saved = null; // after the download: one Blob per file
  let note = false; // a secret note (drop.js): text shown here once, then gone from the server
  let folder = ''; // the name of a folder shared whole (drop.js), its files named "folder/sub/file"
  const baseName = (n) => String(n).split('/').pop() || 'file';
  let pinHeader = {}; // { 'X-Drop-Pin': proof } once the right PIN was typed (links with a PIN)
  const b64u = (buf) => {
    let s = '';
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  // Same as pinProof in drop.js: the server only ever sees this, never the PIN
  const pinProof = async (pin) => b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`omnibeam-pin:${pin}:${keyText}`)));
  // Ask for the PIN (or password: any 4 to 32 characters); resolves with the answer to the first request that it unlocked
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
        const pin = input.value;
        if (pin.length < 4 || pin.length > 32) return status(t('The PIN or password has 4 to 32 characters.'));
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

  // ---- What each file is: an icon, a type label, and whether this browser can show it here ----
  const ext = (name) => (/\.([A-Za-z0-9]{1,8})$/.exec(name) || [])[1]?.toLowerCase() || '';
  function kindOf(f) {
    const type = (f.type || '').toLowerCase();
    const e = ext(f.name);
    if (/^image\/(jpeg|png|gif|webp|avif|bmp|svg\+xml)$/.test(type) || /^(jpe?g|png|gif|webp|avif|bmp)$/.test(e)) return 'image';
    if ((type === 'image/heic' || type === 'image/heif' || /^hei[cf]$/.test(e)) && isIOS) return 'image'; // only Safari shows HEIC
    if (type.startsWith('image/') || /^hei[cf]$/.test(e)) return 'photo';
    if (type.startsWith('video/') || /^(mp4|m4v|mov|webm|mkv|avi|3gp)$/.test(e)) return /^(mp4|m4v|mov|webm)$/.test(e) || /^video\/(mp4|webm|quicktime)$/.test(type) ? 'video' : 'movie';
    if (type.startsWith('audio/') || /^(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/.test(e)) return 'audio';
    if (type === 'application/pdf' || e === 'pdf') return 'pdf';
    if (type.startsWith('text/') || /^(txt|md|csv|json|log|xml|ya?ml|ini|js|ts|py|c|cpp|h|java|go|rs|rb|php|sh|css|html?|srt|vtt)$/.test(e) || type === 'application/json') return 'text';
    if (/^(zip|rar|7z|tar|gz|tgz|bz2|xz)$/.test(e) || /zip|compressed|x-tar/.test(type)) return 'archive';
    if (/^(apk|exe|msi|dmg|pkg|deb|rpm|appimage|ipa)$/.test(e)) return 'app';
    if (/^(xlsx?|ods|numbers)$/.test(e) || /sheet|excel/.test(type)) return 'sheet';
    if (/^(pptx?|odp|key)$/.test(e) || /presentation|powerpoint/.test(type)) return 'slides';
    if (/^(docx?|odt|rtf|pages)$/.test(e) || /word|opendocument\.text/.test(type)) return 'doc';
    return 'file';
  }
  const ICON = { image: '🖼️', photo: '🖼️', video: '🎬', movie: '🎬', audio: '🎵', pdf: '📕', text: '📝', archive: '🗜️', app: '📦', sheet: '📊', slides: '📽️', doc: '📄', file: '📁' };
  // The largest file each kind may be to preview before the whole download (it is fetched and decrypted in memory:
  // phones, iPhones above all, have little)
  const MB = 1048576;
  function previewMax(kind) {
    if (kind === 'image') return 25 * MB;
    if (kind === 'video' || kind === 'audio') return (isIOS ? 60 : 150) * MB;
    if (kind === 'pdf') return isAndroid ? 0 : 30 * MB; // Chrome on Android can't show a PDF inside a page
    if (kind === 'text') return Infinity; // only its start is shown
    return 0;
  }
  const canShow = (kind) => previewMax(kind) > 0;
  // Parts of a link without a download limit can be fetched one file at a time (not counted as a download)
  const partsOk = () => !info.max && !info.once;

  // ---- Reading the encrypted data: part by part as it arrives, so it never sits in memory twice ----
  const partLen = (k) => Math.min(info.part, info.size - k * info.part) + 16;
  // Decrypts the parts from `first` in the response body, in order; onPart(plain bytes, part number). Returns how many
  // plain bytes there were. onRead(bytes so far) for the progress bar.
  async function readParts(r, first, last, onPart, onRead) {
    const reader = r.body.getReader();
    let pending = new Uint8Array(0);
    let n = first;
    let done = 0;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (value) {
        const merged = new Uint8Array(pending.length + value.length);
        merged.set(pending);
        merged.set(value, pending.length);
        pending = merged;
        while (n <= last && pending.length >= partLen(n)) {
          const len = partLen(n);
          const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivFor(n) }, key, pending.subarray(0, len)));
          onPart(plain, n);
          pending = pending.slice(len);
          done += len - 16;
          n++;
        }
        onRead?.(done + pending.length);
      }
      if (end) break;
    }
    return done;
  }
  // One file (or its first `limit` bytes) of a link without a download limit, before the whole download
  async function fetchOne(i, limit = Infinity) {
    const f = files[i];
    const start = offsets[i];
    const end = start + Math.max(1, Math.min(f.size, limit)); // plain bytes [start, end)
    const first = Math.floor(start / info.part);
    const last = Math.floor((end - 1) / info.part);
    const from = first * (info.part + 16);
    const to = last * (info.part + 16) + partLen(last) - 1;
    const r = await fetch(`/api/drop/${id}/data`, { cache: 'no-store', headers: { ...pinHeader, 'X-Range': `bytes=${from}-${to}` } }); // not Range: the live host answers that itself
    if (r.status !== 206 || !r.body) { r.body?.cancel().catch(() => {}); throw new Error('range'); }
    const out = [];
    await readParts(r, first, last, (plain, n) => {
      const a = Math.max(start, n * info.part) - n * info.part;
      const b = Math.min(end, n * info.part + plain.length) - n * info.part;
      if (b > a) out.push(plain.subarray(a, b));
    });
    return new Blob(out, { type: f.type || 'application/octet-stream' });
  }

  // ---- The preview window ----
  const view = $('#drop-view');
  const viewBody = $('#drop-view-body');
  let viewUrl = '';
  function closeView() {
    if (view.open) view.close();
  }
  view.addEventListener('close', () => {
    viewBody.innerHTML = '';
    if (viewUrl) URL.revokeObjectURL(viewUrl);
    viewUrl = '';
  });
  view.addEventListener('click', (e) => { if (e.target === view) closeView(); });
  $('#drop-view-close').onclick = closeView;
  const viewMsg = (text) => {
    viewBody.innerHTML = '<p class="dv-msg"></p>';
    viewBody.firstChild.textContent = text;
  };
  async function preview(i) {
    const f = files[i];
    const kind = kindOf(f);
    $('#drop-view-name').textContent = f.name;
    viewMsg(t('Loading preview…'));
    if (!view.open) view.showModal();
    try {
      const textMax = 256 * 1024;
      const blob = saved ? saved[i] : await fetchOne(i, kind === 'text' ? textMax : Infinity);
      if (!view.open) return;
      if (kind === 'text') {
        const text = await blob.slice(0, textMax).text();
        viewBody.innerHTML = '<pre class="dv-text"></pre>';
        viewBody.firstChild.textContent = text + (f.size > textMax ? '\n…' : '');
        return;
      }
      if (viewUrl) URL.revokeObjectURL(viewUrl);
      viewUrl = URL.createObjectURL(blob);
      let el;
      if (kind === 'image') el = Object.assign(document.createElement('img'), { alt: f.name });
      else if (kind === 'video') el = Object.assign(document.createElement('video'), { controls: true, playsInline: true, autoplay: true });
      else if (kind === 'audio') el = Object.assign(document.createElement('audio'), { controls: true, autoplay: true });
      else el = Object.assign(document.createElement('iframe'), { title: f.name });
      el.className = `dv-${kind}`;
      el.onerror = () => viewMsg(t('No preview for this file. Download it to open it.'));
      el.src = viewUrl;
      viewBody.innerHTML = '';
      viewBody.appendChild(el);
    } catch (err) {
      if (view.open) viewMsg(t('No preview for this file. Download it to open it.'));
      if (err.message !== 'range') window.omniReport?.('link', 'Preview failed: ' + (err.message || err.name || 'unknown'));
    }
  }

  // ---- The file list ----
  function fileRow(f, i) {
    const kind = kindOf(f);
    const li = document.createElement('li');
    li.className = `f k-${kind}${files.length === 1 ? ' one' : ''}`;
    li.innerHTML = '<span class="ic" aria-hidden="true"></span><span class="tx"><span class="n"></span><span class="s"></span></span><span class="acts"></span>';
    li.querySelector('.ic').textContent = ICON[kind];
    li.querySelector('.n').textContent = f.name;
    const e = ext(f.name);
    li.querySelector('.s').textContent = `${formatSize(f.size)}${e ? ' · ' + e.toUpperCase() : ''}`;
    if (f.size && canShow(kind) && partsOk() && f.size <= previewMax(kind)) addPreview(li, i);
    return li;
  }
  function addPreview(li, i) {
    if (li.querySelector('.pv')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pv';
    b.textContent = t('Preview');
    b.setAttribute('aria-label', `${t('Preview')}: ${files[i].name}`);
    b.onclick = () => preview(i);
    li.querySelector('.acts').prepend(b);
  }
  // Small pictures of photos in the list (links without a download limit, small photos only, a few at a time)
  async function thumbnails() {
    const rows = [...$('#drop-files').children];
    const one = files.length === 1;
    let shown = 0;
    for (let i = 0; i < files.length && shown < 24; i++) {
      const f = files[i];
      if (kindOf(f) !== 'image' || f.size > (one ? 12 : 4) * MB || /svg/.test(f.type)) continue;
      shown++;
      try {
        const blob = saved ? saved[i] : await fetchOne(i);
        const img = new Image();
        img.alt = '';
        img.decoding = 'async';
        img.onerror = () => { URL.revokeObjectURL(img.src); img.remove(); rows[i].classList.remove('has-pic'); };
        img.src = URL.createObjectURL(blob);
        const ic = rows[i].querySelector('.ic');
        ic.textContent = '';
        ic.appendChild(img);
        rows[i].classList.add('has-pic');
        ic.onclick = () => preview(i);
      } catch { break; } // the server won't give parts (an old server, or a limit): no pictures
    }
  }
  function showStats() {
    const parts = [];
    if (info.created) parts.push(t('Shared {date}', { date: new Date(info.created).toLocaleDateString(document.documentElement.lang || undefined, { dateStyle: 'medium' }) }));
    if (info.downloads != null) parts.push(t('Downloads: {n}', { n: info.downloads }));
    if (info.views != null) parts.push(t('Views: {n}', { n: info.views }));
    $('#drop-stats').textContent = parts.join(' · ');
    $('#drop-stats').hidden = !parts.length;
  }
  // Copy or share this page's link (with the key: whoever gets it can open it too)
  function shareRow() {
    $('#drop-share').hidden = false;
    $('#drop-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(location.href); } catch {
        const el = Object.assign(document.createElement('input'), { value: location.href });
        document.body.append(el);
        el.select();
        document.execCommand('copy');
        el.remove();
      }
      $('#drop-copy').textContent = '✓ ' + t('Link copied');
      setTimeout(() => { $('#drop-copy').textContent = t('Copy link'); }, 2500);
    };
    if (navigator.share) {
      $('#drop-sharebtn').hidden = false;
      $('#drop-sharebtn').onclick = () => navigator.share({ title: files.length === 1 ? files[0].name : 'OmniBeam', url: location.href }).catch(() => {});
    }
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
      folder = typeof meta.folder === 'string' ? meta.folder.slice(0, 120) : '';
    } catch {
      return status(t('This link is incomplete. Copy the whole link, including the part after #.'));
    }
    let at = 0;
    offsets = files.map((f) => { const o = at; at += f.size; return o; });
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
    if (files.length === 1) document.title = `${baseName(files[0].name)} | OmniBeam`;
    else if (folder) {
      document.title = `📁 ${folder} | OmniBeam`;
      $('h1').textContent = `📁 ${folder}`;
    }
    const list = $('#drop-files');
    files.forEach((f, i) => list.appendChild(fileRow(f, i)));
    status(`${files.length > 1 ? t('{n} files · {size}', { n: files.length, size: formatSize(info.size) }) : t('1 file · {size}', { size: formatSize(info.size) })}. ${t('Available for {time}.', { time })}${info.once ? ' ' + t('This link works for one download only.') : info.max ? ' ' + t('Downloads left: {n} of {max}.', { n: info.left, max: info.max }) : ''}`);
    showStats();
    shareRow();
    if (info.max && info.left === 0) return status(t('Someone is already downloading these files, or the one download was used.'));
    $('#drop-get').textContent = `${t('Download')} · ${formatSize(info.size)}`;
    $('#drop-get').hidden = false;
    if (partsOk()) thumbnails();
  }

  // ---- ZIP of all the files (no compression: it's quick, and photos and videos are compressed already) ----
  const CRC = (() => {
    const tab = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tab[n] = c >>> 0; }
    return tab;
  })();
  const crcUpdate = (c, bytes) => {
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return c;
  };
  let crcs = null; // each file's CRC-32, worked out while downloading
  function makeZip() {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    const used = new Set();
    let offset = 0;
    const d = new Date(info.created || Date.now());
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach((f, i) => {
      // A folder's files keep their folders inside the ZIP (never "..": nothing can land outside it when unzipped)
      const clean = (x) => String(x).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
      const path = folder ? String(f.name).split('/').filter((seg) => seg && seg !== '.' && seg !== '..').map(clean).join('/') : '';
      let name = path || clean(f.name) || 'file';
      const plain = name;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = plain.replace(/(\.[^./]*)?$/, ` (${n})$1`);
      used.add(name.toLowerCase());
      const nameBytes = enc.encode(name);
      const crc = (crcs[i] ^ 0xffffffff) >>> 0;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(10, time, true); local.setUint16(12, date, true); local.setUint32(14, crc, true);
      local.setUint32(18, f.size, true); local.setUint32(22, f.size, true); local.setUint16(26, nameBytes.length, true);
      parts.push(local.buffer, nameBytes, saved[i]);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
      cen.setUint16(12, time, true); cen.setUint16(14, date, true); cen.setUint32(16, crc, true);
      cen.setUint32(20, f.size, true); cen.setUint32(24, f.size, true); cen.setUint16(28, nameBytes.length, true);
      cen.setUint32(42, offset, true);
      central.push(cen.buffer, nameBytes);
      offset += 30 + nameBytes.length + f.size;
    });
    const size = central.reduce((s, p) => s + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }
  $('#drop-zip').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(makeZip());
    a.download = folder ? `${folder.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')}.zip` : `OmniBeam ${new Date(info.created || Date.now()).toISOString().slice(0, 10)}.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  };

  // ---- Downloading like a download manager (links without a download limit: the server gives info.k) ----
  // PARALLEL parts at once, each its own request (Cloudflare may answer it from near the visitor: see p/<k>/<n> on the
  // server), decrypted as each one arrives. A part that stops moving for 20 s is asked for again; after a dropped
  // connection it waits for it to come back and carries on. The parts it has stay in this page, so "Resume download"
  // doesn't start over. With several files, each one's CRC-32 is worked out in order (for the ZIP), and parts aren't
  // fetched far ahead of that, so phones never hold many parts twice.
  const PARALLEL = 6;
  const stallMs = () => window.omnibeamStallMs || 20000;
  const retryMs = (tries) => (window.omnibeamRetryMs || 1000) * 2 ** tries; // 1, 2, 4, 8, 16 s
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  let fast = null; // { parts: Blob per part, plain: parts waiting for the CRC, crcAt } between tries
  async function fetchPart(n, onBytes) {
    const ctl = new AbortController();
    let timer;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), stallMs()); };
    let got = 0;
    arm();
    try {
      const r = await fetch(`/api/drop/${id}/p/${info.k}/${n}`, { signal: ctl.signal });
      if (r.status === 404) throw Object.assign(new Error(t('This link has expired or was deleted.')), { stop: true });
      if (!r.ok || !r.body) throw new Error('part');
      const len = partLen(n);
      const buf = new Uint8Array(len);
      const reader = r.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        arm();
        if (got + value.length > len) throw new Error('part');
        buf.set(value, got);
        got += value.length;
        onBytes(value.length);
      }
      if (got !== len) throw new Error('part');
      clearTimeout(timer);
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivFor(n) }, key, buf));
    } catch (err) {
      onBytes(-got); // these bytes are fetched again
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  async function fastDownload(show) {
    const count = Math.max(1, Math.ceil(info.size / info.part));
    const many = files.length > 1;
    if (!fast) fast = { parts: new Array(count), plain: new Map(), crcAt: 0 };
    if (many && !crcs) crcs = files.map(() => 0xffffffff);
    const queue = [];
    let done = 0;
    for (let n = 0; n < count; n++) {
      if (fast.parts[n]) done += partLen(n);
      else queue.push(n);
    }
    const total = info.size + count * 16;
    // Speed over the last few seconds, and the time left at that speed
    const samples = [[performance.now(), done]];
    let shown = 0;
    const onBytes = (k) => {
      done += k;
      const now = performance.now();
      if (now - shown < 250 && done < total) return;
      shown = now;
      samples.push([now, done]);
      while (samples.length > 2 && now - samples[1][0] > 4000) samples.shift();
      const [t0, b0] = samples[0];
      show(done / total, now - t0 > 700 ? ((done - b0) * 1000) / (now - t0) : 0, total - done);
    };
    const crcStep = () => {
      while (fast.plain.has(fast.crcAt)) {
        const plain = fast.plain.get(fast.crcAt);
        fast.plain.delete(fast.crcAt);
        const at = fast.crcAt * info.part;
        files.forEach((f, i) => {
          const a = Math.max(offsets[i], at);
          const b = Math.min(offsets[i] + f.size, at + plain.length);
          if (b > a) crcs[i] = crcUpdate(crcs[i], plain.subarray(a - at, b - at));
        });
        fast.crcAt++;
      }
    };
    let qi = 0;
    let failure = null;
    const worker = async () => {
      while (!failure && qi < queue.length) {
        if (many && queue[qi] >= fast.crcAt + 4 * PARALLEL) { await sleep(100); continue; }
        const n = queue[qi++];
        for (let tries = 0; ; tries++) {
          try {
            const plain = await fetchPart(n, onBytes);
            fast.parts[n] = new Blob([plain]);
            if (many) { fast.plain.set(n, plain); crcStep(); }
            break;
          } catch (err) {
            if (failure) return;
            if (err.stop) { failure = err; return; }
            if (navigator.onLine === false) {
              status(t('Connection lost. Waiting for it to come back…'));
              await new Promise((ok) => window.addEventListener('online', ok, { once: true }));
              tries = -1;
              continue;
            }
            if (tries >= 5) { failure = Object.assign(new Error(''), { paused: true }); return; }
            await sleep(retryMs(tries));
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
    if (failure) throw failure;
    const all = new Blob(fast.parts);
    fast = null;
    // One more download (the server counts it; it doesn't see the parts Cloudflare sends)
    fetch(`/api/drop/${id}/done`, { method: 'POST', headers: { 'X-Drop-Key': info.k } }).catch(() => {});
    return all;
  }
  const timeLeft = (s) => t('{time} left', { time: s < 60 ? t('{n} s', { n: Math.max(1, Math.round(s)) }) : s < 3600 ? t('{n} min', { n: Math.round(s / 60) }) : t('{n} h', { n: Math.round(s / 3600) }) });

  async function download() {
    const button = $('#drop-get');
    button.hidden = true;
    const bar = $('#drop-bar');
    bar.hidden = false;
    Awake.on();
    const setBar = (frac, speed = 0, left = 0) => {
      bar.firstElementChild.style.width = `${(frac * 100).toFixed(1)}%`;
      const pct = t('Downloading… {pct}%', { pct: Math.floor(frac * 100) });
      status(speed > 0 ? `${pct} · ${formatSize(Math.round(speed))}/s · ${timeLeft(left / speed)}` : pct);
    };
    setBar(0);
    try {
      let all;
      if (info.k && !note) all = await fastDownload(setBar);
      else {
        const r = await fetch(`/api/drop/${id}/data`, { cache: 'no-store', headers: pinHeader });
        if (r.status === 410) throw new Error(note ? t('This note was already read, or someone is reading it now.') : t('Someone is already downloading these files, or the one download was used.'));
        if (r.status === 404) throw new Error(t('This link has expired or was deleted.'));
        if (!r.ok || !r.body) throw new Error('');
        // Decrypt part by part as the data arrives; with several files, each one's CRC-32 too (for the ZIP)
        const out = [];
        const many = !note && files.length > 1;
        crcs = many ? files.map(() => 0xffffffff) : null;
        const total = await readParts(r, 0, Math.max(1, Math.ceil(info.size / info.part)) - 1, (plain, n) => {
          out.push(plain);
          if (!many) return;
          const at = n * info.part;
          files.forEach((f, i) => {
            const a = Math.max(offsets[i], at);
            const b = Math.min(offsets[i] + f.size, at + plain.length);
            if (b > a) crcs[i] = crcUpdate(crcs[i], plain.subarray(a - at, b - at));
          });
        }, (got) => setBar(got / info.size));
        if (total !== info.size) throw new Error('');
        all = new Blob(out);
        out.length = 0;
      }
      if (all.size !== info.size) throw new Error('');
      const many = !note && files.length > 1;
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
      saved = files.map((f, i) => new Blob([all.slice(offsets[i], offsets[i] + f.size)], { type: f.type || 'application/octet-stream' }));
      const rows = [...$('#drop-files').children];
      const saveButtons = [];
      files.forEach((f, i) => {
        const a = document.createElement('a');
        a.className = 'save';
        a.href = URL.createObjectURL(saved[i]);
        a.download = baseName(f.name);
        a.textContent = t('Save');
        a.setAttribute('aria-label', `${t('Save')}: ${f.name}`);
        rows[i].querySelector('.acts').appendChild(a);
        if (f.size && canShow(kindOf(f))) addPreview(rows[i], i);
        saveButtons.push(a);
      });
      bar.hidden = true;
      if (many) {
        $('#drop-zip').hidden = false;
        status(t('Done. Save all as ZIP, or tap a file to save it.'));
      } else status(t('Done. Tap a file to save it.'));
      info.downloads = (info.downloads || 0) + 1;
      showStats();
      if (!partsOk()) thumbnails(); // the photos are here now
      if (saveButtons.length === 1) saveButtons[0].click();
    } catch (err) {
      bar.hidden = true;
      if (err.paused) {
        // The parts it has are kept: the button (or the connection coming back) carries on from there
        status(t('The download paused: the connection was lost. Tap Resume download to carry on from where it stopped.'));
        button.textContent = t('Resume download');
        button.hidden = false;
        window.addEventListener('online', () => { if (!button.hidden) download(); }, { once: true });
        return;
      }
      window.omniReport?.('link', 'Download failed: ' + (err.message || err.name || 'unknown'));
      status(err.message || t('Download failed. Check the connection and try again.'));
      if (!err.message) button.hidden = false;
    } finally {
      Awake.off();
    }
  }

  $('#drop-get').onclick = download;
  init().catch((err) => {
    window.omniReport?.('link', 'Could not open the link: ' + ((err && err.message) || 'unknown'));
    status(t('Download failed. Check the connection and try again.'));
  });
})();
