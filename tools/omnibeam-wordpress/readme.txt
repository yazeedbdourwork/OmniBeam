=== OmniBeam Send Me Files Box ===
Contributors: yazeedbdour
Tags: file upload, drop box, send files, encrypted, upload form
Requires at least: 5.8
Tested up to: 6.8
Requires PHP: 7.2
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A free "Send me files" box: visitors send you files from your page, end-to-end encrypted, straight to your OmniBeam device.

== Description ==

OmniBeam (https://omnibeam.site) is a free web app for sending files between phones and computers. Its "Send me files" box lets visitors, clients or students send you files from your own website. This plugin puts that box on any page with a block or a shortcode.

* Files are encrypted in the visitor's browser and can only be opened by your device. Neither OmniBeam nor this plugin can read them.
* The files never pass through your WordPress site, so there is nothing to store, back up or secure on your server.
* No account, no ads, free.
* Works with the block editor (block "OmniBeam: Send me files") and the classic editor (shortcode).

= How to set it up =

1. On the device that should receive the files, open https://omnibeam.site → ⋯ → **Request files**.
2. Choose **1 year (for a website)**, tap **Make request link**, then **Put this on your website** → **Copy code**.
3. In WordPress, go to **Settings → OmniBeam Box** and paste the code (or just its https://omnibeam.site/embed/r/… link). Save.
4. Add the block **OmniBeam: Send me files** to a page, or the shortcode `[omnibeam_box]`.

= Shortcode =

`[omnibeam_box]` uses the link saved in Settings.
`[omnibeam_box url="https://omnibeam.site/embed/r/…#…" height="520"]` uses its own link and height (300 to 1200 pixels, default 470).

Only links that start with `https://omnibeam.site/embed/r/` are accepted; anything else shows nothing to visitors (editors see a short note on the page).

= External service =

The box is a page of omnibeam.site shown in an iframe. When a visitor opens a page with the box, their browser loads it from https://omnibeam.site and the files they choose are uploaded there, encrypted, until your device collects them (unclaimed files are deleted after 7 days).
Terms: https://omnibeam.site/terms
Privacy: https://omnibeam.site/privacy

== Frequently Asked Questions ==

= Can OmniBeam or my web host read the files? =

No. Each file is encrypted in the visitor's browser with a key sealed to your device's public key. Only your device has the private key.

= What happens when OmniBeam is closed on my device? =

The encrypted files wait on the server and arrive the next time you open OmniBeam (with a notification if you turned notifications on).

= Why did the box stop working? =

Every request link ends at the time you chose when you made it. Make a new one (1 year) and paste its code in Settings → OmniBeam Box.

= Can I put the box on several pages? =

Yes. Every box with the same link sends to the same device. Use a different request link per page if you want to tell them apart.

== Screenshots ==

1. The box on a page.
2. The block and its settings in the editor.
3. Settings → OmniBeam Box.

== Changelog ==

= 1.0.0 =
* First version: block, shortcode and settings page.

== Upgrade Notice ==

= 1.0.0 =
First version.
