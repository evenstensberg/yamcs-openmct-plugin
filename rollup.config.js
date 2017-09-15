import cjs from 'rollup-plugin-commonjs';
import resolve from 'rollup-plugin-node-resolve';

export default {
  input: './index.js',
  output: {
      file: 'yamcs.js',
      format: 'umd',
      name: 'YamcsPlugin'
  },
  plugins: [
    resolve(),
    cjs({
      include: ['node_modules/axios/**']
    })
  ]
};