WATCHLOG - how to put it online for free

What is in this folder
  index.html, style.css, app.js     the website itself
  functions/api/[[path]].js         a small server file that hides your TMDB key from visitors
  README.txt                        this file

STEP 1. Get a free TMDB key
  1. Make a free account at themoviedb.org and confirm your email.
  2. Open Settings, then click "API" in the left menu, and request a key (choose the personal / non-commercial option).
  3. Copy the "API Read Access Token" (very long) OR the "API Key" (short). Either one works.

STEP 2. Put the files on GitHub
  1. Make a free account at github.com.
  2. Click New repository, name it watchlog, press Create repository.
  3. Click "uploading an existing file".
  4. Unzip this folder, then drag EVERYTHING inside it (including the functions folder) into the page.
  5. Press Commit changes.

STEP 3. Publish with Cloudflare Pages
  1. Make a free account at cloudflare.com.
  2. Go to Workers & Pages, click Create application, then Pages, then Connect to Git, and choose GitHub.
  3. Pick your watchlog repository and press Begin setup.
  4. Framework preset: None. Build command: leave empty. Build output directory: type /  (if it complains, try a single dot .).
  5. Press Save and Deploy.

STEP 4. Add your key (the site shows an error message until you do this)
  1. Open your project, then Settings, then Variables and Secrets, then Add.
  2. Name: TMDB_KEY     Value: the key you copied in step 1.
  3. Press Encrypt, then Save.
  4. Go to Deployments and redeploy the latest one so the key takes effect.
  5. Open your site address (it ends with .pages.dev).

Before you share it with other people
  - TMDB's rules ask you to show their logo next to the notice in the footer. Download it from TMDB's "API logos" page
    and add it in index.html inside <footer>.
  - Pick your own name instead of "Watchlog" (search for Watchlog in index.html and app.js).
  - The free TMDB key is for non-commercial projects. If making money is the main purpose, you need a commercial licence from TMDB.
