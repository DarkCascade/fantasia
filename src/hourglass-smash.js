// Hourglass Smash — launcher for the Ebitengine (Go -> WebAssembly) game in
// games/hourglass-smash/. Unlike every other Fantasia game this is not
// JavaScript: CI compiles the Go source to main.wasm (see the "Build Go games"
// step in .github/workflows/deploy.yml) and the game runs inside an iframe, which
// is the only clean way to get rid of a Go wasm instance (it can't be unloaded;
// removing the iframe discards the whole thing). In-game MENU calls
// window.parent.returnToMenu(), which ends up in destroy() below.
(function () {
  "use strict";

  function launchHourglassSmash() {
    if (window.hourglassSmashGame) return window.hourglassSmashGame;

    var host = document.getElementById("game-container");
    var frame = document.createElement("iframe");
    frame.id = "hourglass-smash-frame";
    frame.title = "Hourglass Smash";
    frame.src = "games/hourglass-smash/index.html";
    frame.setAttribute("allow", "autoplay");
    frame.style.cssText =
      "width:100%;height:100%;border:0;display:block;background:#161240;touch-action:none;";
    // Give the game keyboard/focus as soon as it is up.
    frame.addEventListener("load", function () {
      try { frame.contentWindow.focus(); } catch (e) {}
    });
    host.appendChild(frame);

    var handle = {
      frame: frame,
      destroy: function () {
        // Navigate away first so the wasm instance and its WebGL context are
        // released promptly, then drop the element.
        try { frame.src = "about:blank"; } catch (e) {}
        if (frame.parentNode) frame.parentNode.removeChild(frame);
        if (window.hourglassSmashGame === handle) window.hourglassSmashGame = null;
      },
    };
    window.hourglassSmashGame = handle;
    return handle;
  }

  window.launchHourglassSmash = launchHourglassSmash;
})();
