import { Component } from '@theme/component';

export class VideoBackgroundComponent extends Component {
  requiredRefs = ['videoSources', 'videoElement'];

  connectedCallback() {
    super.connectedCallback();

    // Eager load only when explicitly requested (e.g. first section / above-the-fold)
    if (this.hasAttribute('data-eager')) {
      this.#hydrateAndLoad();
      return;
    }

    // Lazy-hydrate sources only when the component is close to the viewport
    // (prevents large MP4 downloads during initial load for below-the-fold videos)
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              io.disconnect();
              this.#hydrateAndLoad();
              return;
            }
          }
        },
        { root: null, rootMargin: '250px 0px', threshold: 0.01 }
      );

      io.observe(this);
      this._io = io;
    } else {
      // Fallback: load immediately on old browsers
      this.#hydrateAndLoad();
    }
  }

  disconnectedCallback() {
    if (this._io) {
      this._io.disconnect();
      this._io = null;
    }
    super.disconnectedCallback?.();
  }

  #hydrateAndLoad() {
    const { videoSources, videoElement } = this.refs;

    for (const source of videoSources) {
      const { videoSource } = source.dataset;
      if (videoSource && !source.getAttribute('src')) {
        source.setAttribute('src', videoSource);
      }
    }

    // Avoid forcing layout: load only once after sources are set
    videoElement.load();

    // If the video is expected to autoplay (muted, loop), the browser will handle it.
  }
}

if (!customElements.get('video-background-component')) {
  customElements.define('video-background-component', VideoBackgroundComponent);
}
