# Portfolio

My portfolio site: eleven projects arranged as a computer is, from web apps at the top of the stack down to ARM assembly at the bottom. Most of them have a live demo you can play with in the browser.

**Live:** [portfolio.felix.best](https://portfolio.felix.best)

It's plain HTML, CSS and JavaScript modules. There's no build step, no framework and no Jekyll, so you can fork it and make it yours with only a text editor.

## Structure

```
index.html              Home: the 3D stack, five layers with every project, about, contact
projects/index.html     All projects as one table, with a language filter
cv/index.html           CV
404.html                The page GitHub Pages shows for a missing address
assets/css/site.css     The design system (colours, type and spacing are variables at the top)
assets/css/demos/       One stylesheet per live demo
assets/js/main.js       Smooth scroll, text animations, command palette (Ctrl/⌘ K), lightbox, lazy demos
assets/js/shell.js      The small shell inside the command palette (help, ls, cd, open, run, whoami)
assets/js/trace.js      The footer's trace of your visit, and its export as a .vcd file
assets/js/hero/         The three.js stack in the hero (an SVG poster stands in when WebGL is off)
assets/js/demos/        The live demos: segment, fat, aristotle, tis, typing, and the Advent of Code calendar (aoc)
assets/vendor/          GSAP, Lenis and three.js, pinned and served locally
assets/img/             Screenshots (web-sized copies in img/opt/) and the AoC video thumbnails (img/aoc/)
assets/fonts/           Mona Sans and Mona Sans Mono (SIL Open Font License, see OFL.txt)
CNAME                   Custom domain for GitHub Pages
.nojekyll               Tells GitHub Pages to serve the files as they are
```

All links are relative, so the site works on a custom domain or at `username.github.io/portfolio/`. Every page reads fine without JavaScript, and the motion respects "reduce motion" in your OS settings.

The page reads like an oscilloscope screen: a graticule behind everything, and each layer is a channel with its own probe colour (`--ch-l4` to `--ch-l0`) for its links, its running trace and its demos. It gets a step darker each layer on the way down (`--tone-l4` to `--tone-l0`) and crosses the syscall line from user space into kernel space. The mark is one trace stepping down all five levels.

## Things to try

- Press **Ctrl K** (or **⌘ K**) and type `help`. The palette is also a small shell: `ls`, `cd l1`, `open fat`, `run tis`, `whoami`.
- Scroll to the bottom of the home page. The footer has drawn your visit as a logic trace, one channel per layer. **Download .vcd** saves it as a Value Change Dump that [GTKWave](https://gtkwave.sourceforge.net) can open.

## Make it your own

1. Fork this repo, or clone it:
   ```
   git clone https://github.com/FelixCenusa/portfolio.git
   ```
2. Edit the text in `index.html`, `projects/index.html` and `cv/index.html`.
   - Each project is one `<article class="proj">` block inside a layer `<section>`. Copy one to add a project.
   - Put screenshots in `assets/img/` and point the `<img>` tags at them.
   - Change the colours in the `:root` block at the top of `assets/css/site.css`: the channel colours, the layer tones and the text and surface steps.
   - A demo is a module in `assets/js/demos/` that exports `mount(root)`. Add `<div class="demo" data-demo="name">` to a page and it loads when scrolled into view.
3. Delete the `CNAME` file, or replace its contents with your own domain.
4. On GitHub, go to **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then save.

That's it, your portfolio is live. To preview locally, run `python -m http.server` in the folder and visit `http://localhost:8000` (the JavaScript modules don't load from a file opened straight from disk).

If this helped you make your own portfolio, a mention somewhere would make my day. Cheers!

## Credits

- Typefaces: [Mona Sans and Mona Sans Mono](https://github.com/github/mona-sans) by GitHub, under the SIL Open Font License 1.1 (`assets/fonts/OFL.txt`).
- [GSAP](https://gsap.com) 3.15 with ScrollTrigger, SplitText and ScrambleText, under the GSAP Standard License.
- [Lenis](https://github.com/darkroomengineering/lenis) 1.3 for smooth scrolling, MIT.
- [three.js](https://threejs.org) r185 for the hero, MIT.
- Code: MIT, see `LICENSE`.
