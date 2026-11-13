// activatedElement is different from document.activeElement -- the latter seems to be reserved
// mostly for input elements. This mechanism allows us to decide whether to scroll a div or to
// scroll the whole document.
let activatedElement = null;

// Previously, the main scrolling element was document.body. If the "experimental web platform
// features" flag is enabled, then we need to use document.scrollingElement instead. There's an
// explanation in #2168: https://github.com/philc/vimium/pull/2168#issuecomment-236488091

const getScrollingElement = () =>
  getSpecialScrollingElement() || document.scrollingElement || document.body;

// Return 0, -1 or 1: the sign of the argument.
// NOTE(smblott; 2014/12/17) We would like to use Math.sign(). However, according to this site
// (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/sign)
// Math.sign() was only introduced in Chrome 38. This caused problems in R1.48 for users with old
// Chrome installations. We can replace this with Math.sign() at some point.
// TODO(philc): 2020-04-28: now we can make this replacement.
const getSign = function (val) {
  if (!val) {
    return 0;
  } else {
    if (val < 0) {
      return -1;
    } else {
      return 1;
    }
  }
};

const scrollProperties = {
  x: {
    axisName: "scrollLeft",
    max: "scrollWidth",
    viewSize: "clientWidth",
  },
  y: {
    axisName: "scrollTop",
    max: "scrollHeight",
    viewSize: "clientHeight",
  },
};

// Translate a scroll request into a number (which will be interpreted by `scrollBy` as a relative
// amount, or by `scrollTo` as an absolute amount). :direction must be "x" or "y". :amount may be
// either a number (in which case it is simply returned) or a string. If :amount is a string, then
// it is either "max" (meaning the height or width of element), or "viewSize". In both cases, we
// look up and return the requested amount, either in `element` or in `window`, as appropriate.
const getDimension = function (el, direction, amount) {
  if (Utils.isString(amount)) {
    const name = amount;
    // the clientSizes of the body are the dimensions of the entire page, but the viewport should
    // only be the part visible through the window
    if ((name === "viewSize") && (el === getScrollingElement())) {
      // TODO(smblott) Should we not be returning the width/height of element, here?
      return (direction === "x") ? globalThis.innerWidth : globalThis.innerHeight;
    } else {
      return el[scrollProperties[direction][name]];
    }
  } else {
    return amount;
  }
};

// Perform a scroll. Return true if we successfully scrolled by any amount, and false otherwise.
const performScroll = function (element, direction, amount) {
  const axisName = scrollProperties[direction].axisName;
  const before = element[axisName];
  if (element.scrollBy) {
    const scrollArg = { behavior: "instant" };
    scrollArg[direction === "x" ? "left" : "top"] = amount;
    element.scrollBy(scrollArg);
  } else {
    element[axisName] += amount;
  }
  return element[axisName] !== before;
};

// Test whether `element` should be scrolled. E.g. hidden elements should not be scrolled.
const shouldScroll = function (element, direction) {
  const computedStyle = globalThis.getComputedStyle(element);
  // Elements with `overflow: hidden` must not be scrolled.
  if (computedStyle.getPropertyValue(`overflow-${direction}`) === "hidden") {
    return false;
  }
  // Elements which are not visible should not be scrolled.
  if (["hidden", "collapse"].includes(computedStyle.getPropertyValue("visibility"))) {
    return false;
  }
  if (computedStyle.getPropertyValue("display") === "none") {
    return false;
  }
  return true;
};

// Test whether element does actually scroll in the direction required when asked to do so. Due to
// chrome bug 110149, scrollHeight and clientHeight cannot be used to reliably determine whether an
// element will scroll. Instead, we scroll the element by 1 or -1 and see if it moved (then put it
// back). :factor is the factor by which :scrollBy and :scrollTo will later scale the scroll amount.
// :factor can be negative, so we need it here in order to decide whether we should test a forward
// scroll or a backward scroll.
// Bug last verified in Chrome 38.0.2125.104.
const doesScroll = function (element, direction, amount, factor) {
  // amount is treated as a relative amount, which is correct for relative scrolls. For absolute
  // scrolls (only gg, G, and friends), amount can be either a string ("max" or "viewSize") or zero.
  // In the former case, we're definitely scrolling forwards, so any positive value will do for
  // delta. In the latter, we're definitely scrolling backwards, so a delta of -1 will do. For
  // absolute scrolls, factor is always 1.
  let delta = (factor * getDimension(element, direction, amount)) || -1;
  delta = getSign(delta); // 1 or -1
  return performScroll(element, direction, delta) && performScroll(element, direction, -delta);
};

const isScrollableElement = function (element, direction, amount, factor) {
  if (direction == null) {
    direction = "y";
  }
  if (amount == null) {
    amount = 1;
  }
  if (factor == null) {
    factor = 1;
  }
  return doesScroll(element, direction, amount, factor) && shouldScroll(element, direction);
};

// From element and its parents, find the first which we should scroll and which does scroll.
const findScrollableElement = function (element, direction, amount, factor) {
  while (
    (element !== getScrollingElement()) && !isScrollableElement(element, direction, amount, factor)
  ) {
    element = DomUtils.getContainingElement(element) || getScrollingElement();
  }
  return element;
};

// On some pages, the scrolling element is not actually scrollable. Here, we search the document for
// the largest visible element which does scroll vertically. This is used to initialize
// activatedElement. See #1358.
const firstScrollableElement = function (element = null) {
  let child;
  if (!element) {
    const scrollingElement = getScrollingElement();
    if (doesScroll(scrollingElement, "y", 1, 1) || doesScroll(scrollingElement, "y", -1, 1)) {
      return scrollingElement;
    } else {
      element = document.body || getScrollingElement();
    }
  }

  if (doesScroll(element, "y", 1, 1) || doesScroll(element, "y", -1, 1)) {
    return element;
  } else {
    // children = children.filter (c) -> c.rect # Filter out non-visible elements.
    const children = Array.from(element.children)
      .map((c) => ({ "element": c, "rect": DomUtils.getVisibleClientRect(c) }))
      .filter((child) => child.rect); // Filter out non-visible elements.
    children.map((child) => child.area = child.rect.width * child.rect.height);
    // Largest to smallest by visible area.
    for (child of children.sort((a, b) => b.area - a.area)) {
      const el = firstScrollableElement(child.element);
      if (el) {
        return el;
      }
    }
    return null;
  }
};

const checkVisibility = function (element) {
  // If the activated element has been scrolled completely offscreen, then subsequent changes in its
  // scroll position will not provide any more visual feedback to the user. Therefore, we deactivate
  // it so that subsequent scrolls affect the parent element.
  const rect = activatedElement.getBoundingClientRect();
  if (
    (rect.bottom < 0) || (rect.top > globalThis.innerHeight) || (rect.right < 0) ||
    (rect.left > globalThis.innerWidth)
  ) {
    return activatedElement = element;
  }
};

// How scrolling is handled by CoreScroller.
//   - For jump scrolling, the entire scroll happens immediately.
//   - For smooth scrolling with distinct key presses, a separate animator is initiated for each key
//     press. Therefore, several animators may be active at the same time. This ensures that two
//     quick taps on `j` scroll to the same position as two slower taps.
//   - For smooth scrolling with keyboard repeat (continuous scrolling), the most recently-activated
//     animator continues scrolling at least until its keyup event is received. We never initiate a
//     new animator on keyboard repeat.

// CoreScroller contains the core function (scroll) and logic for relative scrolls. All scrolls are
// ultimately translated to relative scrolls. CoreScroller is not exported.
const CoreScroller = {
  init() {
    this.time = 0;
    this.lastEvent = this.keyDownKey = null;
    this.installCancelEventListener();
  },

  // This installs listeners for events which should cancel smooth scrolling.
  installCancelEventListener() {
    // NOTE(smblott) With extreme keyboard configurations, Chrome sometimes does not get a keyup
    // event for every keydown, in which case tapping "j" scrolls indefinitely. This appears to be a
    // Chrome/OS/XOrg bug of some kind. See #1549.
    // TODO(philc): I believe some of these returns are unnecessary.
    return handlerStack.push({
      _name: "scroller/track-key-status",
      keydown: (event) => {
        return handlerStack.alwaysContinueBubbling(() => {
          this.keyDownKey = event.code;
          if (!event.repeat) {
            this.time += 1;
          }
          this.lastEvent = event;
        });
      },
      keyup: (event) => {
        return handlerStack.alwaysContinueBubbling(() => {
          if (event.code === this.keyDownKey) {
            this.keyDownKey = null;
            this.time += 1;
          }
        });
      },
      blur: (event) => {
        return handlerStack.alwaysContinueBubbling(() => {
          if (event.target === window) {
            this.time += 1;
          }
        });
      },
    });
  },

  // Return true if CoreScroller would not initiate a new scroll right now.
  wouldNotInitiateScroll() {
    return this.lastEvent && this.lastEvent.repeat && Settings.get("smoothScroll");
  },

  // Calibration fudge factors for continuous scrolling. The calibration value starts at 1.0. We
  // then increase it (until it exceeds @maxCalibration) if we guess that the scroll is too slow, or
  // decrease it (until it is less than @minCalibration) if we guess that the scroll is too fast.
  // The cutoff point for which guess we make is @calibrationBoundary. We require: 0
  // < @minCalibration <= 1 <= @maxCalibration.
  // Controls how much we're willing to slow scrolls down; smaller means more slow down.
  minCalibration: 0.5,
  // Controls how much we're willing to speed scrolls up; bigger means more speed up.
  maxCalibration: 1.6,
  // Boundary between scrolls which are considered too slow, or too fast.
  calibrationBoundary: 150,

  // Scroll element by a relative amount (a number) in some direction.
  scroll(element, direction, amount, continuous) {
    if (continuous == null) {
      continuous = true;
    }
    if (!amount) {
      return;
    }

    if (!Settings.get("smoothScroll")) {
      // Jump scrolling.
      performScroll(element, direction, amount);
      checkVisibility(element);
      return;
    }

    if (this.lastEvent != null ? this.lastEvent.repeat : undefined) {
      return;
    }

    const activationTime = ++this.time;
    const sign = getSign(amount);
    const size = Math.abs(amount);
    const axis = scrollProperties[direction].axisName;
    let a = this.animator;
    const chained = a && a.element === element && a.direction === direction && a.sign === sign;
    if (!chained) {
      a = this.animator = {
        element,
        direction,
        sign,
        axis,
        ratio: globalThis.devicePixelRatio || 1,
        origin: element[axis],
        traveled: 0,
        applied: 0,
        target: 0,
        perFrame: 0,
        previous: null,
      };
    }
    const settled = a.phase === "stop" ? a.stopAt : Math.max(a.target, a.traveled);
    a.target = settled + size * a.ratio;
    a.size = size;
    a.held = 0;
    a.phase = "go";
    a.activationTime = continuous ? activationTime : -1;
    if (!continuous) {
      ++this.time;
    }
    if (!chained) {
      requestAnimationFrame((timestamp) => this.animate(a, timestamp));
    }
  },

  animator: null,
  frameInterval: 1000 / 60,
  frameSamples: [],
  tapSpeedScale: 1.25,
  holdSpeedScale: 0.75,
  holdDelay: 140,
  rampTime: 15,
  stopTime: 60,

  tapPixelsPerFrame(a) {
    const duration = Math.max(100, 20 * Math.log(a.size));
    const perFrame = (a.size / duration) * this.tapSpeedScale * a.ratio * this.frameInterval;
    return Math.max(1, Math.round(perFrame));
  },

  holdPixelsPerFrame(a) {
    const duration = Math.max(100, 20 * Math.log(a.size));
    const perDuration = Math.max(
      a.size * this.minCalibration,
      Math.min(a.size * this.maxCalibration, this.calibrationBoundary),
    );
    const perFrame = (perDuration / duration) * this.holdSpeedScale * a.ratio * this.frameInterval;
    return Math.max(1, Math.round(perFrame));
  },

  place(a, pixels) {
    const before = a.element[a.axis];
    const position = a.origin + (a.sign * pixels) / a.ratio;
    a.element.scrollTo({ [a.direction === "x" ? "left" : "top"]: position, behavior: "instant" });
    return a.element[a.axis] !== before;
  },

  animate(a, timestamp) {
    if (this.animator !== a) {
      return;
    }
    const next = () => requestAnimationFrame((t) => this.animate(a, t));
    if (a.previous == null) {
      a.previous = timestamp;
      return next();
    }
    const elapsed = timestamp - a.previous;
    if (elapsed <= 0) {
      return next();
    }
    a.previous = timestamp;
    if (elapsed < 50) {
      this.frameSamples.push(elapsed);
      if (this.frameSamples.length > 9) {
        this.frameSamples.shift();
      }
      const sorted = [...this.frameSamples].sort((x, y) => x - y);
      this.frameInterval = sorted[sorted.length >> 1];
    }
    const frames = Math.min(4, Math.max(1, Math.round(elapsed / this.frameInterval)));
    const stopFrames = Math.max(1, this.stopTime / this.frameInterval);
    const keyDown = this.time === a.activationTime && this.keyDownKey != null;
    let done = false;

    if (a.phase === "go") {
      if (keyDown) {
        a.held += elapsed;
      }
      const wanted = keyDown && a.held >= this.holdDelay
        ? this.holdPixelsPerFrame(a)
        : this.tapPixelsPerFrame(a);
      a.perFrame += (wanted - a.perFrame) * Math.min(1, elapsed / this.rampTime);
      if (Math.abs(wanted - a.perFrame) < 0.02) {
        a.perFrame = wanted;
      }
      const remaining = a.target - a.traveled;
      const stopDistance = (a.perFrame * stopFrames) / 2;
      if (!keyDown && remaining <= 0) {
        a.phase = "stop";
        a.stopAt = a.traveled + stopDistance;
      } else if (!keyDown && remaining <= stopDistance) {
        a.phase = "stop";
        a.stopAt = a.target;
      } else {
        a.traveled += a.perFrame * frames;
      }
      if (a.phase === "stop") {
        const distance = Math.max(a.stopAt - a.traveled, 0.001);
        a.slowdown = (a.perFrame * a.perFrame) / (2 * distance);
      }
    }
    if (a.phase === "stop") {
      const before = a.perFrame;
      a.perFrame = Math.max(0, before - a.slowdown * frames);
      a.traveled = a.perFrame > 0
        ? Math.min(a.stopAt, a.traveled + ((before + a.perFrame) / 2) * frames)
        : a.stopAt;
      done = a.traveled >= a.stopAt;
    }

    const whole = Math.floor(a.traveled + 1e-6);
    let moved = true;
    if (done) {
      this.place(a, a.stopAt);
    } else if (whole > a.applied) {
      a.applied = whole;
      moved = this.place(a, whole);
    }
    if (done || !moved) {
      this.animator = null;
      return checkVisibility(a.element);
    }
    return next();
  },
};

// Scroller contains the two main scroll functions which are used by clients.
const Scroller = {
  init() {
    const handler = { _name: "scroller/active-element" };
    // Only Chrome has a DOMActivate event. On Firefox, we must listen for click. See #3287.
    const eventName = Utils.isFirefox() ? "click" : "DOMActivate";
    handler[eventName] = (event) =>
      handlerStack.alwaysContinueBubbling(function () {
        // If event.path is present, the true event taget (potentially inside a Shadow DOM inside
        // event.target) can be found as its first element.
        // NOTE(mrmr1993): event.path has been renamed to event.deepPath in the spec, but this
        // change is not yet implemented by Chrome.
        const path = event.deepPath || event.path;
        return activatedElement = path ? path[0] : event.target;
      });
    handlerStack.push(handler);
    CoreScroller.init();
    this.reset();
  },

  reset() {
    activatedElement = null;
  },

  // scroll the active element in :direction by :amount * :factor.
  // :factor is needed because :amount can take on string values, which scrollBy converts to element
  // dimensions.
  scrollBy(direction, amount, factor, continuous) {
    // if this is called before domReady, just use the window scroll function
    if (factor == null) {
      factor = 1;
    }
    if (continuous == null) {
      continuous = true;
    }
    if (!getScrollingElement() && amount instanceof Number) {
      if (direction === "x") {
        globalThis.scrollBy(amount, 0);
      } else {
        globalThis.scrollBy(0, amount);
      }
      return;
    }

    if (!activatedElement) {
      activatedElement = (getScrollingElement() && firstScrollableElement()) ||
        getScrollingElement();
    }
    if (!activatedElement) {
      return;
    }

    // Avoid the expensive scroll calculation if it will not be used. This reduces costs during
    // smooth, continuous scrolls, and is just an optimization.
    if (!CoreScroller.wouldNotInitiateScroll()) {
      const element = findScrollableElement(activatedElement, direction, amount, factor);
      const elementAmount = factor * getDimension(element, direction, amount);
      return CoreScroller.scroll(element, direction, elementAmount, continuous);
    }
  },

  scrollTo(direction, pos) {
    if (!activatedElement) {
      activatedElement = (getScrollingElement() && firstScrollableElement()) ||
        getScrollingElement();
    }
    if (!activatedElement) {
      return;
    }

    const element = findScrollableElement(activatedElement, direction, pos, 1);
    const amount = getDimension(element, direction, pos) -
      element[scrollProperties[direction].axisName];
    return CoreScroller.scroll(element, direction, amount);
  },

  // Is element scrollable and not the activated element?
  isScrollableElement(element) {
    if (!activatedElement) {
      activatedElement = (getScrollingElement() && firstScrollableElement()) ||
        getScrollingElement();
    }
    return (element !== activatedElement) && isScrollableElement(element);
  },

  // Scroll the top, bottom, left and right of element into view. The is used by visual mode to
  // ensure the focus remains visible.
  scrollIntoView(element) {
    if (!activatedElement) {
      activatedElement = getScrollingElement() && firstScrollableElement();
    }
    const rects = element.getClientRects();
    const rect = rects ? rects[0] : undefined;
    if (rect) {
      // Scroll y axis.
      let amount;
      if (rect.bottom < 0) {
        amount = rect.bottom - Math.min(rect.height, globalThis.innerHeight);
        element = findScrollableElement(element, "y", amount, 1);
        CoreScroller.scroll(element, "y", amount, false);
      } else if (globalThis.innerHeight < rect.top) {
        amount = rect.top + Math.min(rect.height - globalThis.innerHeight, 0);
        element = findScrollableElement(element, "y", amount, 1);
        CoreScroller.scroll(element, "y", amount, false);
      }

      // Scroll x axis.
      if (rect.right < 0) {
        amount = rect.right - Math.min(rect.width, globalThis.innerWidth);
        element = findScrollableElement(element, "x", amount, 1);
        CoreScroller.scroll(element, "x", amount, false);
      } else if (globalThis.innerWidth < rect.left) {
        amount = rect.left + Math.min(rect.width - globalThis.innerWidth, 0);
        element = findScrollableElement(element, "x", amount, 1);
        CoreScroller.scroll(element, "x", amount, false);
      }
    }
  },
};

const getSpecialScrollingElement = function () {
  const selector = specialScrollingElementMap[globalThis.location.host];
  if (selector) {
    return document.querySelector(selector);
  }
};

const specialScrollingElementMap = {
  "twitter.com": "div.permalink-container div.permalink[role=main]",
  "reddit.com": "#overlayScrollContainer",
  "new.reddit.com": "#overlayScrollContainer",
  "www.reddit.com": "#overlayScrollContainer",
  "web.telegram.org": ".MessageList",
};

globalThis.Scroller = Scroller;
