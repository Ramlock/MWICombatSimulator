const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { Compilation, sources } = require('webpack');

// Cache busting (fork): GitHub Pages serves every file with max-age=600, so fixed names kept a plain reload on old files.
// Bundles and worker chunks carry a content hash in their names; this rewrites dist/index.html to point at the new main bundle
// and puts the same hash on js/i18n.js and on its translation fetch (locales/*/common.json). clean: true removes the previous build's files.
class CacheBustIndexHtml {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('CacheBustIndexHtml', (compilation) => {
      compilation.hooks.processAssets.tap({ name: 'CacheBustIndexHtml', stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE }, () => {
        const main = [...compilation.namedChunks.get('main').files].find((f) => f.endsWith('.js'));
        const hash = main.split('.')[1];
        const html = compilation.getAsset('index.html').source.source().toString()
          .replace('src="bundle.js"', `src="${main}"`)
          .replace('src="js/i18n.js"', `src="js/i18n.js?v=${hash}"`);
        if (!html.includes(main)) throw new Error('CacheBustIndexHtml: bundle.js script tag not found in index.html');
        compilation.updateAsset('index.html', new sources.RawSource(html));
        // i18next fetches the translations from loadPath, so version that URL too.
        const i18n = compilation.getAsset('js/i18n.js').source.source().toString();
        const versioned = i18n.replace("common.json'", `common.json?v=${hash}'`);
        if (versioned === i18n) throw new Error('CacheBustIndexHtml: loadPath not found in js/i18n.js');
        compilation.updateAsset('js/i18n.js', new sources.RawSource(versioned));
      });
    });
  }
}


module.exports = {
  entry: './src/main.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash:8].js',
    chunkFilename: '[name].[contenthash:8].js',
    clean: true,
  },
  mode: 'development',
  devtool: 'source-map',
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist'),
    },
    compress: true,
    port: 9000,
    open: true,
  },
  plugins: [
    new CacheBustIndexHtml(),
    new CopyWebpackPlugin({
      patterns: [
        { from: path.resolve(__dirname, 'patchNote.json'), to: 'patchNote.json' },
        { from: path.resolve(__dirname, 'index.html'), to: 'index.html' }, // Correctly copy to dist/index.html
        { from: path.resolve(__dirname, 'js'), to: 'js' },
        { from: path.resolve(__dirname, 'locales'), to: 'locales' }
      ],
    }),
  ],
};
