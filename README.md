# Portfolio

My portfolio site: a home page, a CV and ten projects.

**Live:** [portfolio.felix.best](https://portfolio.felix.best)

It's plain HTML, CSS and a little JavaScript. There's no build step, no framework and no Jekyll, so you can fork it and make it yours with only a text editor.

## Structure

```
index.html            Home: intro, about and selected projects
projects/index.html   All projects, with a language filter
cv/index.html         CV
assets/css/site.css   All styles (colours and type are variables at the top)
assets/js/site.js     Scroll reveals, filters, image viewer, the 7-segment counter
assets/img/           Screenshots and the portrait (web-sized copies in img/opt/)
assets/fonts/         Mona Sans (SIL Open Font License, see OFL.txt)
CNAME                 Custom domain for GitHub Pages
.nojekyll             Tells GitHub Pages to serve the files as they are
```

All links are relative, so the site works on a custom domain, at `username.github.io/portfolio/` or opened straight from disk.

## Make it your own

1. Fork this repo, or clone it:
   ```
   git clone https://github.com/FelixCenusa/portfolio.git
   ```
2. Edit the text in `index.html`, `projects/index.html` and `cv/index.html`.
   - Each project is one `<article class="proj">` block. Copy one to add a project.
   - Put screenshots in `assets/img/` and point the `<img>` tags at them.
   - Change the colours in the `:root` block at the top of `assets/css/site.css`.
3. Delete the `CNAME` file, or replace its contents with your own domain.
4. On GitHub, go to **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then save.

That's it, your portfolio is live. To preview locally, open `index.html` in a browser, or run `python -m http.server` in the folder and visit `http://localhost:8000`.

If this helped you make your own portfolio, a mention somewhere would make my day. Cheers!

## Credits

- Typeface: [Mona Sans](https://github.com/github/mona-sans) by GitHub, under the SIL Open Font License 1.1 (`assets/fonts/OFL.txt`).
- Code: MIT, see `LICENSE`.
