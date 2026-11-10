<?php
/**
 * Plugin Name:       OmniBeam Send Me Files Box
 * Plugin URI:        https://omnibeam.site/embed
 * Description:       Put your OmniBeam "Send me files" box on any page: visitors send you files, end-to-end encrypted, and they arrive in OmniBeam on your device. Use the block, or the shortcode [omnibeam_box url="..." height="..."].
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.2
 * Author:            Yazeed Bdour
 * Author URI:        https://omnibeam.site/about
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       omnibeam-box
 *
 * OmniBeam Send Me Files Box is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
 * details: https://www.gnu.org/licenses/gpl-2.0.html
 *
 * How it works: the box itself is OmniBeam's page https://omnibeam.site/embed/r/<id>#<key>, shown in an <iframe>.
 * Files are encrypted in the visitor's browser inside that page; this plugin never sees them and stores nothing but
 * the box link (in the omnibeam_box_url option). Only links to https://omnibeam.site/embed/r/ are accepted.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'OMNIBEAM_BOX_VERSION', '1.0.0' );
define( 'OMNIBEAM_BOX_HEIGHT', 470 );

/**
 * The box link, cleaned: the address itself, or the src="" of a whole pasted OmniBeam code. '' when it isn't a
 * "Send me files" box link of omnibeam.site.
 *
 * @param mixed $value What was typed or pasted.
 * @return string
 */
function omnibeam_box_clean_url( $value ) {
	$value = trim( (string) $value );
	if ( preg_match( '/src\s*=\s*["\']([^"\']+)["\']/i', $value, $m ) ) {
		$value = html_entity_decode( $m[1], ENT_QUOTES, 'UTF-8' );
	}
	$value = trim( $value );
	if ( ! preg_match( '~^https://omnibeam\.site/embed/r/[A-Za-z0-9_-]{8,40}(\?lang=[a-z]{2})?#[A-Za-z0-9_.-]{10,400}$~', $value ) ) {
		return '';
	}
	return $value;
}

/**
 * Height in pixels, from 300 to 1200.
 *
 * @param mixed $value Height.
 * @return int
 */
function omnibeam_box_clean_height( $value ) {
	$h = absint( $value );
	if ( ! $h ) {
		$h = absint( get_option( 'omnibeam_box_height', OMNIBEAM_BOX_HEIGHT ) );
	}
	if ( ! $h ) {
		$h = OMNIBEAM_BOX_HEIGHT;
	}
	return max( 300, min( 1200, $h ) );
}

/**
 * The HTML of the box (shared by the shortcode and the block).
 *
 * @param string $url    Box link (may be empty: the one saved in Settings is used).
 * @param mixed  $height Height in pixels.
 * @return string
 */
function omnibeam_box_html( $url, $height ) {
	$clean = omnibeam_box_clean_url( '' !== trim( (string) $url ) ? $url : get_option( 'omnibeam_box_url', '' ) );
	if ( '' === $clean ) {
		// Visitors see nothing; people who can edit the page see why
		if ( current_user_can( 'edit_posts' ) ) {
			return '<p class="omnibeam-box-error"><strong>' . esc_html__( 'OmniBeam box:', 'omnibeam-box' ) . '</strong> '
				. esc_html__( 'add your box link (it starts with https://omnibeam.site/embed/r/) in the block, the shortcode or Settings → OmniBeam Box.', 'omnibeam-box' ) . '</p>';
		}
		return '';
	}
	$height = omnibeam_box_clean_height( $height );
	$lang   = preg_match( '/\?lang=([a-z]{2})#/', $clean, $m ) ? $m[1] : '';
	$home   = 'https://omnibeam.site/' . ( $lang ? $lang . '/' : '' );
	$style  = 'width:100%;max-width:520px;height:' . $height . 'px;border:0;border-radius:18px';
	return '<div class="omnibeam-box">'
		. '<iframe src="' . esc_url( $clean, array( 'https' ) ) . '" title="' . esc_attr__( 'Send me files', 'omnibeam-box' ) . '" style="' . esc_attr( $style ) . '" loading="lazy"></iframe>'
		. '<p class="omnibeam-box-credit" style="margin:6px 0;font:13px/1.4 system-ui,sans-serif"><a href="' . esc_url( $home ) . '">' . esc_html__( 'Powered by OmniBeam', 'omnibeam-box' ) . '</a> · '
		. esc_html__( 'free, end-to-end encrypted file sharing', 'omnibeam-box' ) . '</p>'
		. '</div>';
}

/**
 * [omnibeam_box url="https://omnibeam.site/embed/r/…#…" height="470"]
 *
 * @param array|string $atts Shortcode attributes.
 * @return string
 */
function omnibeam_box_shortcode( $atts ) {
	$atts = shortcode_atts(
		array(
			'url'    => '',
			'height' => '',
		),
		$atts,
		'omnibeam_box'
	);
	return omnibeam_box_html( $atts['url'], $atts['height'] );
}
add_shortcode( 'omnibeam_box', 'omnibeam_box_shortcode' );

/**
 * The block "OmniBeam: Send me files" (block.js, plain JavaScript, no build step). It is drawn on the server
 * (render_callback), so the page always gets the same checked and escaped HTML as the shortcode.
 */
function omnibeam_box_register_block() {
	if ( ! function_exists( 'register_block_type' ) ) {
		return;
	}
	wp_register_script(
		'omnibeam-box-block',
		plugins_url( 'block.js', __FILE__ ),
		array( 'wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components', 'wp-i18n' ),
		OMNIBEAM_BOX_VERSION,
		true
	);
	wp_localize_script(
		'omnibeam-box-block',
		'omnibeamBox',
		array(
			'savedUrl' => omnibeam_box_clean_url( get_option( 'omnibeam_box_url', '' ) ),
			'height'   => omnibeam_box_clean_height( 0 ),
		)
	);
	if ( function_exists( 'wp_set_script_translations' ) ) {
		wp_set_script_translations( 'omnibeam-box-block', 'omnibeam-box' );
	}
	register_block_type(
		'omnibeam/box',
		array(
			'editor_script'   => 'omnibeam-box-block',
			'attributes'      => array(
				'url'    => array(
					'type'    => 'string',
					'default' => '',
				),
				'height' => array(
					'type'    => 'number',
					'default' => 0,
				),
			),
			'render_callback' => 'omnibeam_box_render_block',
		)
	);
}
add_action( 'init', 'omnibeam_box_register_block' );

/**
 * @param array $attributes Block attributes.
 * @return string
 */
function omnibeam_box_render_block( $attributes ) {
	$url    = isset( $attributes['url'] ) ? $attributes['url'] : '';
	$height = isset( $attributes['height'] ) ? $attributes['height'] : 0;
	return omnibeam_box_html( $url, $height );
}

/**
 * Settings → OmniBeam Box: the box link used when a block or shortcode has none of its own, and the height.
 */
function omnibeam_box_settings_init() {
	register_setting(
		'omnibeam_box',
		'omnibeam_box_url',
		array(
			'type'              => 'string',
			'sanitize_callback' => 'omnibeam_box_sanitize_url_setting',
			'default'           => '',
		)
	);
	register_setting(
		'omnibeam_box',
		'omnibeam_box_height',
		array(
			'type'              => 'integer',
			'sanitize_callback' => 'omnibeam_box_clean_height',
			'default'           => OMNIBEAM_BOX_HEIGHT,
		)
	);
}
add_action( 'admin_init', 'omnibeam_box_settings_init' );

/**
 * @param mixed $value Pasted link or code.
 * @return string
 */
function omnibeam_box_sanitize_url_setting( $value ) {
	$clean = omnibeam_box_clean_url( $value );
	if ( '' === $clean && '' !== trim( (string) $value ) ) {
		add_settings_error( 'omnibeam_box_url', 'omnibeam_box_url', __( 'That is not an OmniBeam box link. It must start with https://omnibeam.site/embed/r/ (in OmniBeam: ⋯ → Request files → Put this on your website).', 'omnibeam-box' ) );
		return get_option( 'omnibeam_box_url', '' );
	}
	return $clean;
}

function omnibeam_box_admin_menu() {
	add_options_page(
		__( 'OmniBeam Box', 'omnibeam-box' ),
		__( 'OmniBeam Box', 'omnibeam-box' ),
		'manage_options',
		'omnibeam-box',
		'omnibeam_box_settings_page'
	);
}
add_action( 'admin_menu', 'omnibeam_box_admin_menu' );

function omnibeam_box_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$url    = get_option( 'omnibeam_box_url', '' );
	$height = omnibeam_box_clean_height( 0 );
	?>
	<div class="wrap">
		<h1><?php echo esc_html__( 'OmniBeam Box', 'omnibeam-box' ); ?></h1>
		<p><?php echo esc_html__( 'A "Send me files" box for your site: visitors choose files, they are encrypted in their browser and arrive in OmniBeam on your device.', 'omnibeam-box' ); ?></p>
		<ol>
			<li><?php echo esc_html__( 'On the device that should receive the files, open omnibeam.site → ⋯ → Request files.', 'omnibeam-box' ); ?></li>
			<li><?php echo esc_html__( 'Choose "1 year (for a website)", tap Make request link, then Put this on your website → Copy code.', 'omnibeam-box' ); ?></li>
			<li><?php echo esc_html__( 'Paste the code (or just its https://omnibeam.site/embed/r/… link) below and save.', 'omnibeam-box' ); ?></li>
			<li><?php echo esc_html__( 'Add the block "OmniBeam: Send me files" to a page, or the shortcode [omnibeam_box].', 'omnibeam-box' ); ?></li>
		</ol>
		<form method="post" action="options.php">
			<?php settings_fields( 'omnibeam_box' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="omnibeam_box_url"><?php echo esc_html__( 'Box link', 'omnibeam-box' ); ?></label></th>
					<td>
						<textarea id="omnibeam_box_url" name="omnibeam_box_url" rows="3" class="large-text code" placeholder="https://omnibeam.site/embed/r/…#…"><?php echo esc_textarea( $url ); ?></textarea>
						<p class="description"><?php echo esc_html__( 'Used by every box that has no link of its own. Only https://omnibeam.site/embed/r/ links are accepted.', 'omnibeam-box' ); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="omnibeam_box_height"><?php echo esc_html__( 'Height (pixels)', 'omnibeam-box' ); ?></label></th>
					<td><input type="number" id="omnibeam_box_height" name="omnibeam_box_height" min="300" max="1200" step="10" value="<?php echo esc_attr( (string) $height ); ?>"></td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
		<?php if ( '' !== $url ) : ?>
			<h2><?php echo esc_html__( 'Preview', 'omnibeam-box' ); ?></h2>
			<?php echo omnibeam_box_html( $url, $height ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- built from escaped parts in omnibeam_box_html() ?>
		<?php endif; ?>
		<p><?php echo esc_html__( 'Privacy: the files never pass through your WordPress site. The box link is public (anyone who sees your page can send you files), so do not put private text in the request.', 'omnibeam-box' ); ?></p>
	</div>
	<?php
}

/**
 * A "Settings" link next to the plugin in the Plugins list.
 *
 * @param array $links Action links.
 * @return array
 */
function omnibeam_box_action_links( $links ) {
	array_unshift( $links, '<a href="' . esc_url( admin_url( 'options-general.php?page=omnibeam-box' ) ) . '">' . esc_html__( 'Settings', 'omnibeam-box' ) . '</a>' );
	return $links;
}
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'omnibeam_box_action_links' );
