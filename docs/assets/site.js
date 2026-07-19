// Typewriter reveal for the hero tagline, matching the in-game dialogue box's
// own pacing (app/src/pages/DayScenePage.tsx types at ~34ms/char). Falls back
// to an instant, un-animated render when the visitor prefers reduced motion.
(function () {
  var text = "Your life autosaves.";
  var el = document.getElementById("tagline");
  if (!el) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) {
    el.textContent = text;
    return;
  }

  var i = 0;
  var cursor = document.createElement("span");
  cursor.className = "cursor";

  function tick() {
    el.textContent = text.slice(0, i);
    el.appendChild(cursor);
    i++;
    if (i <= text.length) {
      setTimeout(tick, 34);
    }
  }
  tick();
})();
