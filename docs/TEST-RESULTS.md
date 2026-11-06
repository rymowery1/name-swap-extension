# v1 acceptance test results

Status of the 30 acceptance tests in the spec, as of the first build.

**How things were tested:** the rules engine has 35 unit tests in Node (`npm test`). The popup and
content script were driven in a real browser against a dev harness that uses the actual `src/`
files with a stand-in for Chrome's storage API. Title *detection* was additionally verified against
live YouTube (home, search and watch pages) in Chrome.

**Not yet done: a manual pass with the extension actually installed in Chrome.** Everything below
marked ⚠ needs that. Nothing is known to be broken — those cases just can't be honestly called
passed until the extension runs as an extension.

| ID | Test | Status | Notes |
|---|---|---|---|
| T01 | Fresh installation | ✅ | Empty storage yields no rules, global toggle defaults to On, titles untouched |
| T02 | Create rule | ✅ | New rule appears expanded and disabled |
| T03 | Auto persistence | ✅ / ⚠ | Survives popup close + page reload; real browser restart untested |
| T04 | Contains | ✅ | Unit + live |
| T05 | Starts with | ✅ | Unit + live |
| T06 | Ends with | ✅ | Unit + live |
| T07 | Case sensitivity | ✅ | Includes Unicode cases where naive lowercasing changes string length |
| T08 | Remove | ✅ | |
| T09 | Replace | ✅ | Including `$&`-style text treated literally, never as a pattern |
| T10 | Disable rule | ✅ | Stays stored, stops applying, later rules still run |
| T11 | Enable rule | ✅ | |
| T12 | Global pause | ✅ | Restores text, `title` attributes and `aria-label` prefixes |
| T13 | Global resume | ✅ | Fixed during testing — see note below |
| T14 | Multiple rules | ✅ | Each rule processes the previous rule's output |
| T15 | Reorder rules | ✅ | Verified that reversing order produces a different result |
| T16 | Delete rule | ✅ | Undo restores it at its original position |
| T17 | Invalid rule | ✅ | Stored but inert; doesn't block neighbouring rules |
| T18 | Empty result | ✅ | Original title preserved |
| T19 | Homepage | ✅ / ⚠ | Lazy-loaded cards transform in the fixture; live home feed not yet run with the extension installed |
| T20 | Search | ✅ / ⚠ | Search-result title markup confirmed live; transformation verified in fixture |
| T21 | Watch page | ✅ | Verified live on youtube.com — main title and suggested titles both rewritten, then restored |
| T22 | Subscriptions | ⚠ | Uses the same markup as the home grid, but not separately verified |
| T23 | SPA navigation | ✅ | `yt-navigate-finish` / `yt-page-data-updated` handled |
| T24 | Rapid editing | ✅ | 25 edits with randomised completion times collapsed to 1 write, latest value won |
| T25 | Many video cards | ✅ | 400 cards added at once: all transformed; full rescan of 406 titles ≈ 2ms |
| T26 | Browser restart | ⚠ | Needs the installed extension |
| T27 | Multiple YouTube tabs | ✅ / ⚠ | Config changes propagate via `storage.onChanged`; verified single-tab, not across two real tabs |
| T28 | Normal YouTube behavior | ✅ | Live check: links, hrefs, thumbnails, playback, description and comments all unaffected |
| T29 | Accessibility | ✅ / ⚠ | Every control has an accessible name; tab order verified; no focusables inside hidden regions. Not tested with a real screen reader |
| T30 | Storage failure | ✅ | Error surfaced to the user, no false "Saved." confirmation, recovers cleanly |

## Three bugs found and fixed during testing

**1. Hidden elements were visible.** CSS `display` rules were overriding the `hidden` attribute, so
the Undo bar showed on a fresh popup and collapsed rule bodies would have stayed open. Fixed with a
global `[hidden] { display: none !important; }`.

**2. Resume after pause could lag indefinitely.** Updates were scheduled with
`requestAnimationFrame`, which a background tab throttles or stops entirely — a backgrounded YouTube
tab could sit on a stale title. Settings changes now recalculate immediately, and the batched DOM
work has a timer running alongside the animation frame.

**3. The extension would have done nothing on real YouTube.** This is the one the fixture could
never have caught. The safety check that decides whether a title element is safe to edit required
the title text to be the element's only child. On real YouTube, search-result titles sit next to a
hidden `yt-icon` element, so every single candidate was rejected — selectors matched 12 elements and
accepted 0. The check now ignores child elements that carry no text. On a live watch page this took
it from 0 usable titles to 32, with no rejections, while still correctly refusing to touch titles
made of genuinely mixed markup.

Also corrected while reading the live DOM: the suggested-video selector. The real class is
`a.ytLockupMetadataViewModelTitle` (camelCase), not the BEM-style `.yt-lockup-metadata-view-model__title`
that was guessed from the spec. Both are now listed, along with a structural fallback.

## Suggested manual pass before calling v1 done

With the extension installed (see README), and one rule such as *Starts with* `NEW VIDEO: ` → *Remove*:

1. Home feed — scroll a long way, confirm newly loaded titles change too
2. Search results page
3. Open a video — main title and the suggested list down the right
4. Subscriptions feed
5. Click between pages without reloading; confirm rules keep applying
6. Open two YouTube tabs, change a rule in one, confirm the other updates
7. Toggle the extension off — every title should snap back
8. Quit Chrome entirely, reopen — rules should still be there
9. Confirm videos still play and links still go to the right places
