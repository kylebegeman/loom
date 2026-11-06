# Mobile navigation

Home and thread routes share the [root native stack](../../apps/mobile/src/Stack.tsx)
so UIKit can animate the header within one navigation controller. The iPad sidebar
has its own stack. Splitting Home and threads between controllers loses that
continuous transition. How the stack becomes columns, sheets and panes is in
[Mobile layout](./mobile-layout.md).

## Selecting versus drilling in

Opening a page has two intents, and each has one action:

- **Select** replaces the active thread or pull request. Everything that selects
  (rows, the command palette, compose, notifications, deep links) uses
  [`selectWorkspaceDetail`](../../apps/mobile/src/features/workspace/workspace-detail-selection.ts),
  which the root stack's router handles. On iOS a selection from Sites, Search or a
  project retains its originating route chain so Back returns there; a direct
  link or root selection starts from Threads. The page already showing keeps its
  key, so the detail column updates in place instead of pushing.
- **Drill in** opens a page over the current one so Back returns, with
  `StackActions.push`.

`navigate` to `Thread` or `PullRequest` is rejected by lint, because it pushes
or updates in place depending on what happens to be on top. Never infer the
choice from transition events: UIKit reports the sidebar column appearing in
split views too. The one native signal the router uses is the card native Back
is popping. The workspace navigator reports it, and a selection never reuses
that card.

On iOS, the toolbar's Settings gear opens a sheet over the originating tab with its own page
stack. Dismissing it restores the underlying route and tab. Android retains
Settings as a workspace destination.

The Sites tab browses websites; its `Sites` route drills into one when `siteId` is
present, or lists all websites when it is absent. An unavailable ID must not fall
back to a different website. The detail's Visit website action opens the browser;
selecting a website keeps the native Back path to its originating list or search.

The iOS primary selection lives in `Home.params.workspaceTab`, so external links
and the native tab controller agree even above the React tabs provider. Search
also records `searchReturnTab` for native cancellation. The workspace keeps each
tab's route chain separately; selecting a match retains Search as its origin.

The iOS primary set is Threads, Sites and the native search-role tab, regardless of
older saved tab order or visibility preferences. Search spans connected computers
and the shared Library, and category routes remain useful when a source is offline.
The secondary destinations retain their own routes rather than being remapped to
primary tabs. Keep the Android tab policy independent when changing shared state
or route types.

## Native controls and surfaces

An iOS drop-down with `nativeTrigger` renders its visible button and menu through
the same SwiftUI `Menu`. The source button must own its glass material for the
system's button-to-menu transition. A React-rendered glass label under a separate
native menu gives two unrelated surfaces. The shared adapter keeps action IDs,
checked states, disabled/destructive actions, nesting and persistent selection
menus; its React children remain the Android fallback. Content-row long-press
menus continue through the contextual menu path and must preserve a normal tap.

The native stack header bridge also preserves submenu icons and palette layout.
Its menu state comes from JavaScript on each update. The screens fork's submenu
containers cannot carry disabled, destructive or subtitle properties, so gate
each executable leaf action and preserve its permission checks when regrouping
header tools. A disabled parent alone cannot protect the actions inside it.

Native headers leave both standard and scroll-edge appearances transparent, and
registered scroll views own the soft edge effect. Clearing only the scroll-edge
appearance lets the standard appearance return as an opaque band when scrolled.
Keep extra Settings spacing inside the scroll view's content inset. Padding around
the containing native stack creates a fixed strip outside the scroll view's blur.

Project icons retain their standard rounded-square monogram or image treatment.
Rows can reserve an alignment slot, but the slot must not add another circular
surface around the icon.

## UIKit constraints

The [react-native-screens fork](../operations/mobile-screens-fork.md)
preserves behavior that is easy to break when changing native headers:

- Compact workspace detail cards hide the bottom bar through
  `Stack.Screen.hidesBottomBarWhenPushed`. Their `Stack.Host` explicitly enables
  `managesTabBarVisibility`, including on a fresh root that has never pushed a
  detail. The native navigation controller forwards this policy only for an
  opted-in stack in the selected tab, before
  root layout, and restores the actual top screen after a cancelled interactive
  Back. Its appearance callback also covers returning to a retained detail tab.
  Toggling `Tabs.Host.tabBarHidden` from JavaScript for a
  card push tears down the tab-hosted Search field, which returns in the top
  header. Split and hinge layouts retain their column visibility policy.
- The brand belongs in `headerTitle`. On iOS 26.5, UIKit morphs a background-free
  leading toolbar item's rectangle into the next screen's glass back button,
  even when the items have different identifiers.
- UIKit's scroll-edge fade does not recognize Fabric text views. An empty native
  label supplies the custom title's geometry. Removing that apparently unused
  view changes the fade.
- Leading, trailing, and center item groups need independent caches. A button can
  belong to only one group; rebuilding an unchanged group can pull its buttons
  out of a group UIKit is still animating. Cache ownership also includes the
  header config, whose event emitter changes on remount.
- A horizontal ScrollView at its leading edge must yield to the full-screen back
  gesture. Upstream gives every horizontal ScrollView priority, so swiping back
  on a code block or table can only bounce its content.
- UIKit draws the header's scroll-edge blur inside the scroll view, and workspace
  columns pad their content away from the iPhone Duo's vertical bar. Register a
  header scroll view only through
  [`NativeScrollViewMarker`](../../apps/mobile/src/native/NativeScrollViewMarker.tsx)
  or `NativeScrollView`: their native wrapper widens the scroll view under that
  bar, so the blur reaches it while the content stays in the safe area. On the
  left it shifts React Native's content view back through its bounds origin,
  never with a content offset: React Native rewrites offsets on its own layout
  passes, which left threads shifted under the bar. Lint rejects
  `ScrollViewMarker` imported anywhere else.

The fork adds native header props that require code generation and a new binary.
See the [fork build instructions](../operations/mobile-screens-fork.md).

## Native media presentations

iOS delegates full-screen video to [AVKit](../../apps/mobile/modules/t3-native-controls/ios/T3NativeVideoPresentation.swift)
and images and documents to [Quick Look](../../apps/mobile/modules/t3-native-controls/ios/T3NativeFilePresentation.swift).
Each framework owns its controls and transition. A separate UIKit zoom transition
prevents AVKit's native Close action from exiting full screen and interferes with
Quick Look's interactive return to its thumbnail. The AVKit entry selector is
guarded, with standard modal presentation as the fallback.

[Thumbnail registration](../../apps/mobile/modules/t3-native-controls/ios/T3NativePresentation.swift)
holds weak view references for transition and share-sheet anchors. It does not own
the preview; a source row can disappear while a native presentation is open.
Identifiers must distinguish attachments that are visible at the same time.
Native promises complete after dismissal so callers keep local file leases until
the preview or share flow has finished.

Treat a dismissal request as pending until UIKit finishes its current transition.
Starting another dismissal while presentation or an interactive dismissal is
settling can strand the controller. Video cleanup restores the previous audio
configuration only if it still matches the preview's configuration. It must not
deactivate the shared audio session, which may belong to another player or recorder.

Video playback holds the first signed asset URL for the lifetime of the preview.
Following credential refreshes reactively would restart playback. Quick Look copies
original bytes into its own temporary directory so preview and sharing cannot
mutate a draft or workspace file.
