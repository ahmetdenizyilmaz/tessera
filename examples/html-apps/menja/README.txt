Menja — standalone HTML panel app
Original game by Caleb Miller: https://github.com/MilllerTime/menja
Pinned revision: 51bd97609c32f07cb6729528b3443da934e655df

This app, including the Tessera-specific adaptations in this directory, is
distributed under GNU GPL version 3. See LICENSE.txt. It comes without warranty.
All corresponding source is included here as readable HTML, CSS and JavaScript.
Open index.html in a browser or import this folder into Tessera; no compiler,
bundler, downloaded dependencies, or additional source is required to run it.
The app is independently executable and requests no Tessera permissions.

Modified for Tessera on 2026-10-14: removed analytics and external navigation;
removed upstream development tests and performance instrumentation; added
panel.css/panel.js, keyboard-accessible menus, credits and license viewer,
automatic pause, robust best-score storage and redraw on paused resize.
Other upstream files retain the original renderer, physics and gameplay.
