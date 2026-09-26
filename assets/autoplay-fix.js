(() => {
  const HERO_SELECTOR = '.hero video';
  const INSPIRE_SCOPE = '.inspire-carousel';
  const INSPIRE_VIDEO_SELECTOR = 'video.inspire-video';

  const heroVideo = document.querySelector(HERO_SELECTOR);
  const inspireScope = document.querySelector(INSPIRE_SCOPE);

  if (!heroVideo && !inspireScope) return;

  const forceInlineMuted = (video) => {
    try {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
    } catch (_) {}
  };

  const safePlay = async (video) => {
    if (!video) return;
    forceInlineMuted(video);

    try {
      await video.play();
    } catch (_) {}
  };

  if (heroVideo) {
    forceInlineMuted(heroVideo);

    if ('IntersectionObserver' in window) {
      const heroIO = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        heroIO.disconnect();
        safePlay(heroVideo);
      }, { threshold: 0.1 });

      heroIO.observe(heroVideo);
    } else {
      safePlay(heroVideo);
    }
  }

  if (inspireScope) {
    const videos = Array.from(inspireScope.querySelectorAll(INSPIRE_VIDEO_SELECTOR));

    if (videos.length) {
      videos.forEach(forceInlineMuted);

      const pauseAllExcept = (keep) => {
        videos.forEach((video) => {
          if (video !== keep) {
            try { video.pause(); } catch (_) {}
          }
        });
      };

      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
          const best = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

          if (!best || best.intersectionRatio < 0.6) return;

          pauseAllExcept(best.target);
          safePlay(best.target);
        }, { threshold: [0, 0.25, 0.6, 0.85] });

        videos.forEach((video) => io.observe(video));
      } else {
        safePlay(videos[0]);
      }
    }
  }

  const unlock = () => {
    if (heroVideo) safePlay(heroVideo);

    if (inspireScope) {
      const first = inspireScope.querySelector(INSPIRE_VIDEO_SELECTOR);
      if (first) safePlay(first);
    }

    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('click', unlock);
  };

  window.addEventListener('touchstart', unlock, { passive: true, once: true });
  window.addEventListener('click', unlock, { passive: true, once: true });
})();