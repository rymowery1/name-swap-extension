# YouTube Title Changer

A Chrome extension that rewrites the video titles you see on YouTube, using rules you write.

It changes **only the text displayed in your browser**. It doesn't touch the actual videos, their
real titles on YouTube, thumbnails, or what anyone else sees. No account, no server, no analytics,
no network requests of any kind — your rules are stored locally in Chrome.

---

## Installing it (takes about a minute)

It isn't on the Chrome Web Store, so you load it yourself in developer mode:

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select this folder: `~/Developer/youtube-title-changer`
5. Pin it to your toolbar (puzzle-piece icon → pin)

Then open YouTube and click the toolbar icon to add rules.

> After changing any file in `src/`, go back to `chrome://extensions` and hit the reload arrow on
> the extension card, then refresh your YouTube tab.

---

## Using it

Click the toolbar icon. The whole extension is that one popup — there's no settings page.

Each **rule** answers three questions:

| | |
|---|---|
| **Where to look** | Title *contains* / *starts with* / *ends with* your text |
| **Text to find** | The exact text to match (plain text — not a pattern or code) |
| **What to do** | *Remove it*, or *Replace it* with something else |

Tick **Match capital letters exactly** if `NEW VIDEO:` should not match `new video:`.
By default capitalisation is ignored.

**Example:** *Starts with* `NEW VIDEO: ` → *Remove* turns
"NEW VIDEO: Making a desk from scratch" into "Making a desk from scratch".

### Things worth knowing

- **New rules start switched off.** Fill one in, then flip its switch on.
- **Rules run top to bottom**, each working on the result of the one above it. Use the ▲▼ arrows to
  reorder — the titles recalculate immediately.
- **Everything saves itself.** There's no Save button. If a save ever fails, the popup says so
  rather than pretending it worked.
- **Nothing is destructive.** Switching a rule off, or the whole extension off, puts the original
  titles straight back on any open YouTube tabs.
- **Limits:** up to 50 rules, 200 characters per text box. If rules would push a title past 500
  characters, the original title is kept instead. The limits tell you when you reach them — a
  counter appears in the last 20 characters of a text box, and the Add rule button says why it
  has stopped rather than just greying out.
- **A rule that would empty a title is ignored**, and the original title is kept — so you can't
  accidentally blank out every video.
- **Deleting shows an Undo** for about six seconds, while the popup stays open.
- **"Needs setup"** on a card means the rule can't run yet (usually an empty *Text to find*, or
  *Replace* with nothing to replace it with). It stays saved, it just doesn't do anything.

### How it looks

Dark by default, with a light counterpart that follows your system setting. Amber marks whatever
is switched on or selected, so on/off reads as a change in brightness rather than only colour —
which keeps it legible on a dim screen or if you don't separate red and green easily.

Type is Inter where you have it installed, falling back to your system font otherwise. The font is
never fetched over the network, so the extension still makes no external requests at all.

### Where it works

Home feed, search results, the watch page title, suggested/related videos, and subscriptions.

Shorts, YouTube Music, and playlist-specific layouts are deliberately left alone in v1. So is any
title in markup the extension can't identify with confidence — it would rather skip a title than
risk breaking the page.

---

## For development

```bash
npm test
```

Runs the rules-engine and storage unit tests (42 of them) in Node — no dependencies, no browser needed.

### Trying it without installing

There's a dev harness that runs the popup and a YouTube-markup fixture as ordinary web pages,
using a small stand-in for Chrome's storage API:

```bash
python3 tools/dev-server.py 8777
```

- Popup: <http://localhost:8777/dev/popup-harness.html>
- Fake YouTube page: <http://localhost:8777/dev/youtube-fixture.html>

The harness pulls in the real `src/` files, so there's no second copy of anything to drift.

### Regenerating the icons

```bash
node tools/make-icons.cjs
```

### How the code is organised

| File | What it does |
|---|---|
| `src/engine.js` | Pure text transformation. No Chrome APIs — this is the part that ports to Safari later. |
| `src/storage.js` | Reads/writes settings, normalises anything odd, serialises writes so fast edits can't land out of order. |
| `src/popup.js` | The popup: rule cards, inline editing, reordering, undo, auto-save. |
| `src/content.js` | Finds titles on YouTube and keeps them updated through scrolling, navigation and re-renders. |
| `manifest.json` | Manifest V3. Requests the `storage` permission and access to `www.youtube.com` — nothing else. |

The content script is written to fail safe: if YouTube changes its markup, unrecognised titles are
left untouched rather than guessed at.
