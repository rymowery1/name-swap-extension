# YouTube Title Changer

**Product Requirements Document — Version 1.0**  
**Status:** Specification finalized; implementation not started  
**Date:** November 5, 2026  
**Primary platform:** Chrome desktop  
**Future platform:** Safari on iPhone  
**Initial distribution:** Locally installed Chrome extension

## 1. Product overview

YouTube Title Changer automatically modifies video titles displayed on YouTube.com according to rules created by the user.

Users manage everything through a compact popup opened from the Chrome toolbar.

The extension changes only the displayed text. It does not modify videos, their actual YouTube titles, thumbnails, or other users' experiences.

### Product principles

- **Simple:** One popup. No settings pages or onboarding flows.
- **Automatic:** Rules apply without manual intervention.
- **Controlled:** Users create, edit, enable, and disable individual rules.
- **Reversible:** Turning rules off restores the corresponding original or recalculated titles.
- **Persistent:** Settings are automatically saved locally.
- **Private:** No account, backend, analytics, or external AI service.

## 2. V1 feature requirements

| Feature | Requirement |
|---|---|
| Chrome toolbar popup | Required |
| Global enable/disable | Required |
| Create rules | Required |
| Edit rules inline | Required |
| Individual rule toggles | Required |
| Delete rules | Required |
| Reorder rules | Required |
| Automatic persistence | Required |
| Contains matching | Required |
| Starts with matching | Required |
| Ends with matching | Required |
| Remove text | Required |
| Replace text | Required |
| Case-sensitive option | Required |
| Manual Save button | Excluded |
| Separate settings page | Excluded |
| Regex / AND-OR conditions | Excluded |
| Default rules / presets | Excluded |
| AI transformations | Excluded |
| Cloud synchronization | Excluded |

## 3. Popup UX specification

### Dimensions and structure

**Preferred width:** 380 px  
**Maximum height:** 560 px, with internal vertical scrolling

The popup contains:

1. Product name and global on/off toggle.
2. Rules heading with enabled-rule count.
3. A vertically ordered list of expandable rule cards.
4. An Add rule button.
5. Contextual saving or error feedback.

No other pages or dialogs are required.

### Empty state

On first installation:

- The global extension toggle defaults to On.
- The rules list is empty.
- No YouTube titles change.
- The interface displays: "No rules yet. Add a rule to start changing video titles."
- A prominent Add rule button is available.

### Rule card — Collapsed

Each collapsed card displays:

- An automatically generated description, such as `Starts with "NEW VIDEO:" → Remove`.
- The rule's on/off toggle.
- An expand/collapse affordance.
- Rule ordering controls where applicable.

Custom rule names are not supported in v1.

### Rule card — Expanded

An expanded card contains:

- Match condition: Contains / Starts with / Ends with.
- Find text input.
- Action: Remove / Replace.
- Replacement text input (only for Replace).
- Case-sensitive matching checkbox.
- Delete rule action.

Editing is inline. There is no separate editor or Save button.

The initial interface should allow one rule card to be expanded at a time.

### Creating a rule

1. User selects Add rule.
2. A new rule appears expanded and disabled.
3. The user enters a matching condition and search text.
4. The user chooses Remove or Replace.
5. The rule configuration is stored automatically.
6. Once valid, the user can enable the rule.

New rules remain disabled until the user explicitly enables them.

### Editing a rule

- Editing an existing rule updates its saved configuration automatically.
- If enabled and valid, changes apply to YouTube automatically.
- If temporarily invalid, the rule stops applying until corrected.
- The enabled preference is preserved while a rule is temporarily invalid.
- Clicking outside the popup closes it without discarding completed edits.

### Global toggle

Turning the extension off restores original titles on open YouTube pages.

Individual rules remain visible, editable, and retain their saved enabled states.

Turning the extension back on reapplies all valid, individually enabled rules.

### Individual rule toggles

Turning a rule off immediately recalculates titles using the remaining enabled rules.

The rule itself remains stored.

Turning it back on reapplies it automatically.

### Reordering rules

Use small Move Up and Move Down controls.

Changes save automatically and immediately recalculate the resulting titles.

Drag-and-drop is unnecessary for v1.

### Deleting rules

Selecting Delete removes a rule immediately and displays a temporary Undo action for approximately six seconds, while the popup remains open.

Deletion is persistent after Undo expires or the popup closes.

## 4. Rule-processing specification

### Matching

| Condition | Behavior |
|---|---|
| Contains | Match every nonoverlapping occurrence |
| Starts with | Match the beginning of the title once |
| Ends with | Match the ending of the title once |

Matching is literal text matching, not a regular expression entered by the user.

Case-insensitive matching is the default.

### Actions

**Remove:** Deletes the matched text.

**Replace:** Substitutes the matched text with a user-provided replacement.

A Replace rule with an empty replacement is invalid. Users should choose Remove instead.

### Processing order

Rules execute from top to bottom in their saved order.

Each subsequent rule processes the output from the previous rule.

Whenever rules change, the entire sequence restarts from the original title.

### Whitespace

When a title is modified:

- Remove leading whitespace from the final result.
- Remove trailing whitespace from the final result.
- Preserve internal whitespace.
- Leave completely unmatched titles unchanged.

### Invalid and unexpected results

- Empty or whitespace-only Find values make a rule invalid.
- Invalid rules are stored but not executed.
- If the final title would be empty or whitespace-only, restore the original.
- If a rule makes no difference, continue processing normally.
- Preserve Unicode characters and punctuation unless explicitly targeted.
- Never interpret user-entered text as executable code.

## 5. Technical architecture

### Platform

Chrome extension using Manifest V3 and plain JavaScript, HTML, and CSS.

No React dependency or backend is required.

### Main modules

**Popup UI** — Manages user interactions, local configuration, and rule ordering.

**Shared rules engine** — A pure transformation module that accepts an original title and configuration and returns the transformed title. This module must not depend directly on Chrome-specific APIs.

**Chrome storage adapter** — Persists the rules, global enabled state, and schema version.

**YouTube content adapter** — Finds supported video title elements and updates their displayed text.

**Page-change observer** — Handles dynamically added titles, scrolling, navigation, and YouTube page updates.

### Storage

Use Chrome's extension-local storage API.

Suggested configuration schema:

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "rules": [
    {
      "id": "unique-rule-id",
      "enabled": true,
      "match": "startsWith",
      "find": "NEW VIDEO:",
      "action": "remove",
      "replacement": "",
      "caseSensitive": false
    }
  ]
}
```

Rules are stored in processing order.

Configuration changes should use serialized writes so rapid edits cannot overwrite newer settings with older ones. Failed writes must surface an error instead of falsely claiming the settings were saved.

### YouTube integration

Use content scripts to modify supported YouTube pages.

The initial implementation targets:

- YouTube homepage video cards.
- Search results.
- Watch-page main titles.
- Suggested video cards.
- Subscriptions feeds.

Shorts-specific views, YouTube Music, and playlist-specific layouts are not required for v1.

### Original-title tracking

Keep original titles in temporary page memory rather than permanently storing users' viewing histories.

Track the original title, last applied text, and associated video identity when available.

When YouTube replaces or updates a video card, detect whether the source title has changed before reapplying transformations.

Avoid observing and endlessly reprocessing changes generated by the extension itself.

### Dynamic updates

The implementation must handle:

- Initial page load.
- Infinite scrolling.
- Navigation without a full reload.
- Changes to saved rules.
- Rule enable/disable events.
- Global pause/resume.
- YouTube rerendering existing title elements.

### Permissions and privacy

Request only the storage permission and access necessary for supported YouTube pages.

No YouTube account authorization, video-data API, remote service, analytics, or external network requests are required.

## 6. Accessibility and resilience

The popup must support keyboard navigation, visible focus indicators, meaningful input labels, and appropriately labeled toggle states.

All controls must have usable targets and readable contrast.

For YouTube title changes, update accessible title representations where safely identifiable, without disturbing video links or their behavior.

If YouTube changes its markup, unsupported title elements should remain untouched rather than risking damage to unrelated page content.

## 7. Testing and acceptance criteria

| ID | Test | Pass condition |
|---|---|---|
| T01 | Fresh installation | Empty rules; original YouTube titles |
| T02 | Create rule | New inactive rule appears |
| T03 | Auto persistence | Rule survives popup close and browser restart |
| T04 | Contains | Every intended occurrence is replaced |
| T05 | Starts with | Only beginning is matched |
| T06 | Ends with | Only ending is matched |
| T07 | Case sensitivity | Matching respects selected behavior |
| T08 | Remove | Only targeted text is removed |
| T09 | Replace | Targeted text is replaced correctly |
| T10 | Disable rule | Rule remains stored and stops applying |
| T11 | Enable rule | Rule applies automatically |
| T12 | Global pause | All transformed titles restore |
| T13 | Global resume | Enabled rules reapply |
| T14 | Multiple rules | Processing order is respected |
| T15 | Reorder rules | Result recalculates correctly |
| T16 | Delete rule | Rule is removed and Undo works |
| T17 | Invalid rule | No unintended transformations |
| T18 | Empty result | Original title is preserved |
| T19 | Homepage | Visible and newly loaded cards update |
| T20 | Search | Titles update after searching |
| T21 | Watch page | Main title and suggestions update |
| T22 | Subscriptions | Titles update correctly |
| T23 | SPA navigation | Rules continue applying without refresh |
| T24 | Rapid editing | Latest settings win; no lost updates |
| T25 | Many video cards | No noticeable scrolling degradation |
| T26 | Browser restart | Configuration is retained |
| T27 | Multiple YouTube tabs | Rule changes propagate to open tabs |
| T28 | Normal YouTube behavior | Links, thumbnails, and playback still work |
| T29 | Accessibility | Popup keyboard and screen-reader checks pass |
| T30 | Storage failure | Clear error; no false saved confirmation |

### Unit tests

Test the transformation engine independently of the browser, including overlapping rules, punctuation, emoji, whitespace, Unicode, empty inputs, and case-insensitive matching.

### Integration tests

Test the extension against actual YouTube page layouts, including dynamic navigation and content that loads after scrolling.

### Manual acceptance testing

Before release, complete a full manual test in desktop Chrome using a locally installed unpacked extension.

All critical tests must pass before considering publication.

## 8. Development sequence

**Phase 1 — Rules engine:** Implement and test matching, removal, replacement, ordering, and validation.

**Phase 2 — Popup interface:** Implement the compact popup, expandable rules, independent toggles, automatic persistence, and deletion.

**Phase 3 — YouTube integration:** Add title detection and transformations across the five supported surfaces.

**Phase 4 — Dynamic behavior:** Handle navigation, newly loaded content, storage changes, and title restoration.

**Phase 5 — QA and refinement:** Run automated and manual tests, fix compatibility issues, improve performance, and verify accessibility.

**Phase 6 — Local distribution:** Package the extension for installation through Chrome's developer mode.

Chrome Web Store publication is a separate decision after v1 is validated.

## 9. Future roadmap

**V2 — Safari on iPhone**

Port the shared rules engine and adapt browser-specific storage, popup interfaces, packaging, and page integration.

The extension will operate on youtube.com in Safari, not the native YouTube iOS app.

Future possibilities include preset rules, import/export, more sophisticated matching, channel-specific rules, and additional browsers. None are prerequisites for v1.

## 10. Definition of done

Version 1 is complete when a user can install the extension locally, create rules entirely through its popup, see those rules reliably transform YouTube titles, independently toggle and edit them, and retain their configuration between browser sessions.

The extension must preserve normal YouTube functionality and provide predictable, reversible transformations.

**Product status: Ready to build.**

---

## References

- [Chrome Extensions: Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [Chrome Extensions: Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome Extensions: Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome Extensions: Action API](https://developer.chrome.com/docs/extensions/reference/api/action)
