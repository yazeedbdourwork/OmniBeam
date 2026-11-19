// How to Use page: each feature's short video (public/media/f-<feature>-<lang>.mp4, English voice, captions in the
// page's language) shows as a picture with a play button, so nothing is downloaded until it is pressed. Pressing it
// plays the video in the same place, with sound. Without this script (or on the AMP copy) the picture is a link to
// the video file.
document.addEventListener('click', (e) => {
  const link = e.target.closest('a.howto-video');
  if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
  e.preventDefault();
  const img = link.querySelector('img');
  const video = document.createElement('video');
  video.controls = true;
  video.playsInline = true;
  video.poster = img ? img.currentSrc || img.src : '';
  if (img && img.alt) video.setAttribute('aria-label', img.alt);
  video.src = link.href;
  const box = document.createElement('div');
  box.className = 'howto-video';
  box.appendChild(video);
  link.replaceWith(box);
  video.play().catch(() => {});
  video.focus();
});
