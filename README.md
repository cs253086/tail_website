# TAIL OS — website

The marketing & documentation site for [TAIL OS](https://tail-os.com) — a real-time microkernel
operating system written in Rust for robotics and safety-critical systems.

## Stack

Plain static HTML, CSS, and JavaScript. No build step. Hosted on Bluehost.

```
.
├── index.html            # Landing page (hero, features, install, usage, community)
├── download.html         # Downloads for QEMU / Raspberry Pi / source
├── docs/
│   └── index.html        # Installation + quick-start + API reference
├── assets/
│   ├── css/style.css     # Design system + page styles
│   ├── js/main.js        # Nav, tabs, copy-to-clipboard, reveal on scroll
│   └── img/favicon.svg
├── .htaccess             # Clean URLs + caching + compression for Bluehost/Apache
└── robots.txt
```

## Local development

Any static server works:

```bash
python3 -m http.server 8080
# or
npx serve .
```

Then open <http://localhost:8080>.

## Deploying to Bluehost

1. Log in to Bluehost cPanel → **File Manager**.
2. Upload the contents of this repo to `public_html/` (or the subfolder mapped to `tail-os.com`).
3. Make sure `.htaccess` is uploaded (it may be hidden — enable "Show Hidden Files").
4. That's it. Static files, no server config required.

Alternatively, use FTP / SFTP with the credentials from cPanel.

## Design

- Dark-first theme with a subtle grid + glow background.
- Brand gradient: `#7c5cff → #22d3ee → #f0abfc`.
- Type: **Inter** for UI, **JetBrains Mono** for code.
- Accessible: semantic HTML, `prefers-reduced-motion` respected, keyboard-navigable tabs.
