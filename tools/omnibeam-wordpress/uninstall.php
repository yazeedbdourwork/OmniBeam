<?php
/**
 * Removes the plugin's two settings when it is deleted in WordPress (Plugins → Delete).
 * License: GPL-2.0-or-later
 */
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}
delete_option( 'omnibeam_box_url' );
delete_option( 'omnibeam_box_height' );
