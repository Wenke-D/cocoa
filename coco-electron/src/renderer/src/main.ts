import { mount } from 'svelte'
import { throw_coco } from '@shared/error'
import './theme.css'
import App from './App.svelte'

const target = document.getElementById('app')
if (target === null) {
  throw_coco('missing #app mount point')
}

mount(App, { target })
