export default {
  async fetch(request, env, ctx) {
    // This tells Cloudflare to serve your normal HTML/CSS files
    // It also unlocks the ability to use Secrets (env variables)
    return env.ASSETS.fetch(request);
  },
};
