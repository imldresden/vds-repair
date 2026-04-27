Requirements: 
- NodeJS v. 20+: `https://nodejs.org/en/download/package-manager`

How to run: 
- `npm install` brings all dependencies. 
- `npm run dev` enables http://localhost:3000/ that can be opened in the browser.
  - run the server `../server` for project creation and file management.
  - the navbar item to use the server depends on the `.env` entry `VITE_DEPLOY=false`. 
- `npm run build` creates static files on `./dist`. This folder is gitignored on purpose. 
  - In order to test the static site, use `npm install serve --global` and `serve -p 3000`, which enables http://localhost:3000/. 
  - To deploy to Github Pages:
    - Set `VITE_DEPLOY` to `true` in `.env`
    - Run `npm run build`
    - Find `.folder}` and add `https://imldresden.github.io/vds-repair/` to the return string in `./dist/index.html`.
    - Move the contents of `/dist` to the `deploy` branch, commit and push.
