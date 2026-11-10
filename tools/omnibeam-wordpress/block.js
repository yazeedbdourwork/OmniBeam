/**
 * OmniBeam Send Me Files Box: the block for the WordPress editor. Plain JavaScript (no build step): it uses the
 * editor's own React through wp.element. The page itself is drawn by PHP (omnibeam_box_render_block), so this
 * only edits the two settings and shows a preview.
 * License: GPL-2.0-or-later
 */
( function ( wp ) {
	'use strict';
	var el = wp.element.createElement;
	var __ = wp.i18n.__;
	var be = wp.blockEditor || wp.editor;
	var c = wp.components;
	var saved = ( window.omnibeamBox && window.omnibeamBox.savedUrl ) || '';
	var defaultHeight = ( window.omnibeamBox && window.omnibeamBox.height ) || 470;
	var BOX = /^https:\/\/omnibeam\.site\/embed\/r\/[A-Za-z0-9_-]{8,40}(\?lang=[a-z]{2})?#[A-Za-z0-9_.-]{10,400}$/;

	// The same rule as omnibeam_box_clean_url() in PHP: the link itself, or the src="" of a pasted OmniBeam code
	function cleanUrl( value ) {
		value = String( value || '' ).trim();
		var m = value.match( /src\s*=\s*["']([^"']+)["']/i );
		if ( m ) {
			var t = document.createElement( 'textarea' );
			t.innerHTML = m[ 1 ];
			value = t.value.trim();
		}
		return BOX.test( value ) ? value : '';
	}

	wp.blocks.registerBlockType( 'omnibeam/box', {
		apiVersion: 2,
		title: __( 'OmniBeam: Send me files', 'omnibeam-box' ),
		description: __( 'A box where visitors send you files, end-to-end encrypted, to your OmniBeam device.', 'omnibeam-box' ),
		icon: 'upload',
		category: 'widgets',
		keywords: [ 'omnibeam', 'upload', 'files', 'drop box' ],
		attributes: {
			url: { type: 'string', default: '' },
			height: { type: 'number', default: 0 },
		},
		supports: { html: false },
		edit: function ( props ) {
			var a = props.attributes;
			var url = cleanUrl( a.url ) || ( a.url ? '' : saved );
			var height = Math.max( 300, Math.min( 1200, a.height || defaultHeight ) );
			var bad = a.url && ! cleanUrl( a.url );
			var blockProps = be.useBlockProps ? be.useBlockProps() : {};
			return el(
				'div',
				blockProps,
				el(
					be.InspectorControls,
					null,
					el(
						c.PanelBody,
						{ title: __( 'Box', 'omnibeam-box' ), initialOpen: true },
						el( c.TextareaControl, {
							label: __( 'Box link', 'omnibeam-box' ),
							help: __( 'In OmniBeam: ⋯ → Request files → Put this on your website → Copy code. Paste the code or its https://omnibeam.site/embed/r/… link. Empty: the link saved in Settings → OmniBeam Box.', 'omnibeam-box' ),
							value: a.url,
							onChange: function ( v ) { props.setAttributes( { url: cleanUrl( v ) || v } ); },
						} ),
						el( c.RangeControl, {
							label: __( 'Height (pixels)', 'omnibeam-box' ),
							min: 300,
							max: 1200,
							step: 10,
							value: height,
							onChange: function ( v ) { props.setAttributes( { height: v || 0 } ); },
						} )
					)
				),
				bad || ! url
					? el(
						c.Placeholder,
						{ icon: 'upload', label: __( 'OmniBeam: Send me files', 'omnibeam-box' ) },
						el( 'p', null, bad
							? __( 'That is not an OmniBeam box link. It must start with https://omnibeam.site/embed/r/.', 'omnibeam-box' )
							: __( 'Paste your box link in the block settings on the right, or save one in Settings → OmniBeam Box.', 'omnibeam-box' ) ),
						el( c.TextareaControl, {
							value: a.url,
							placeholder: 'https://omnibeam.site/embed/r/…#…',
							onChange: function ( v ) { props.setAttributes( { url: cleanUrl( v ) || v } ); },
						} )
					)
					: el(
						'div',
						{ className: 'omnibeam-box' },
						el( 'iframe', {
							src: url,
							title: __( 'Send me files', 'omnibeam-box' ),
							style: { width: '100%', maxWidth: '520px', height: height + 'px', border: 0, borderRadius: '18px', pointerEvents: 'none' },
							loading: 'lazy',
						} ),
						el( 'p', { style: { margin: '6px 0', font: '13px/1.4 system-ui, sans-serif' } }, __( 'Powered by OmniBeam', 'omnibeam-box' ) + ' · ' + __( 'free, end-to-end encrypted file sharing', 'omnibeam-box' ) )
					)
			);
		},
		// Drawn by PHP on the page (render_callback)
		save: function () { return null; },
	} );
} )( window.wp );
