'use strict';
// Runs in /heic-frame.html, a hidden sandboxed frame of the TV page (tv.js: Tv.convertHeic). The TV page sends an
// iPhone photo (HEIC) as a Blob; this answers with a JPG Blob made by heic2any.js, or an error. Nothing else.
addEventListener('message', async (e) => {
  if (e.source !== parent || !e.data || !(e.data.blob instanceof Blob)) return;
  const id = e.data.id;
  try {
    let jpg = await heic2any({ blob: e.data.blob, toType: 'image/jpeg', quality: 0.85 });
    if (Array.isArray(jpg)) jpg = jpg[0]; // a burst or Live Photo: its first picture
    parent.postMessage({ id, jpg }, '*'); // (the frame has no origin of its own, so '*'; only a picture goes back)
  } catch (err) {
    parent.postMessage({ id, error: String((err && err.message) || err) }, '*');
  }
});
parent.postMessage({ heicReady: true }, '*');
