# Ranch study background

Desktop ranch pages expose a 学习背景 entry beside the motion control. Entering requests native fullscreen on the stable `#public-profile-ranch` container, not the scene that is rebuilt by the existing minute-by-minute satiety refresh. If the browser denies fullscreen, the same view fills the webpage and explicitly describes that fallback.

Study mode hides navigation, feeding controls and ordinary ranch labels. A small lower toolbar toggles the local-time clock, focus timer, scene motion and exit. The clock and focus panel can both be hidden for a scenery-only background. Clock/timer visibility and the selected duration are device-local preferences; no account or server state changes.

Focus sessions offer 15, 25, 45 or 60 minutes, start/pause/resume/reset and a completion message. They use an absolute deadline rather than counting timer callbacks, so background throttling or sleep does not lose elapsed time. Hiding the timer or leaving fullscreen does not pause it; the normal entry displays its remaining time. Reloading or closing the page resets the current session. The clock uses the device timezone, independently of Beijing-based ranch seasons.

Native browser exit and the exit button restore normal navigation. Escape exits the webpage fallback. Removing the ranch while fullscreen also restores the shell. No sound, notifications permission or wake lock is requested.

Verification: timer state/deadline and duration tests run in CI. Chromium and WebKit browser checks exercise native entry/exit, unsupported-fullscreen fallback, Escape, clock toggles, start/pause/resume, hidden timer continuation, a completed 15-minute session, minute-by-minute ranch rerenders, reset, element removal and mobile entry suppression. Existing ranch/chrome regression coverage remains in place.
