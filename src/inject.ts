//  refer: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script
import { URL } from 'url'
import { Window } from 'happy-dom'
import { uniq } from './shared'
import type { CDNPluginOptions, ScriptNode, LinkNode, ModuleInfo, ResolverFunction } from './interface'

function isScript(url: string) {
  return url.split('.').pop() === 'js' ? 'script' : 'link'
}

interface Options {
  extra: ModuleInfo,
  baseURL: string
}

// [baseURL][version][name]
function replaceURL(p: string, url: string | ResolverFunction, options: Options) {
  const template = typeof url === 'function' ? url(p, options.extra) : url
  return template.replace(/\[version\]/, options.extra.version).replace(/\[baseURL\]/, options.baseURL).replace(/\[name\]/, options.extra.name)
}

function makeURL(moduleMeta: ModuleInfo, baseURL: string) {
  const { version, name: packageName, relativeModule, resolve } = moduleMeta
  if (!baseURL) return
  const u = new URL(`${packageName}@${version}/${relativeModule}`, baseURL).href
  if (resolve) return replaceURL(u, resolve, { extra: moduleMeta, baseURL })
  return u
}

function makeNode(moduleInfo: ModuleInfo): ScriptNode | LinkNode {
  return {
    tag: 'link',
    url: new Set(),
    name: moduleInfo.name,
    extra: moduleInfo
  }
}

class InjectScript {
  private modules: Map<string, LinkNode | ScriptNode>
  private window: Window
  constructor(modules: Map<string, ModuleInfo>, url: string) {
    this.modules = this.prepareSource(modules, url)
    this.window = new Window()
  }

  toTags() {
    const tags = []
    this.modules.forEach((node) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { tag, url, name: _, extra: __, ...restProps } = node
      if (url.size) {
        url.forEach((l) => {
          const element = this.window.document.createElement(tag)
          element.setAttribute(tag === 'script' ? 'src' : 'href', l)
          for (const prop in restProps) {
            element.setAttribute(prop, restProps[prop])
          }
          tags.push(element.toString())
        })
      }
    })
    return tags
  }

  text(html: string, transformHook?: CDNPluginOptions['transform']) {
    const { document } = this.window
    document.body.innerHTML = html
    if (transformHook) {
      const hook = transformHook()
      this.modules.forEach((node) => {
        if (node.tag === 'script') {
          hook.script?.(node)
        }
        if (node.tag === 'link') {
          hook.link?.(node)
        }
      })
    }
    // issue #6
    const element = document.body.querySelector('title')
    const tags = this.toTags()
    const text = tags.join('\n')
    element.insertAdjacentHTML('beforebegin', text)
    return document.body.innerHTML
  }

  private prepareSource(modules: Map<string, ModuleInfo>, baseURL: string) {
    const container: Map<string, LinkNode | ScriptNode> = new Map()

    const traverseModule = (moduleMeta: ModuleInfo, moduleName: string) => {
      const { spare } = moduleMeta
      if (!spare) return
      if (Array.isArray(spare)) {
        for (const s of uniq(spare)) {
          traverseModule({ ...moduleMeta, spare: s }, moduleName)
        }
        return
      } 
      const tag = isScript(spare)
      const mark = `__${moduleName}__${tag}__`
      if (container.has(mark)) {
        const node = container.get(mark)
        node.url.add(spare)
        return
      }
      const node = makeNode(moduleMeta)
      node.url.add(spare)
      node.tag = isScript(spare)
      container.set(mark, node)
    }

    modules.forEach((meta, moduleName) => {
      const node = makeNode(meta)
      const url = makeURL(meta, baseURL)
      if (!url) return
      node.url.add(url)
      node.tag = isScript(url)
      const mark = `__${moduleName}__${node.tag}__`
      container.set(mark, node)
      if (meta.spare) traverseModule(meta, moduleName)
    })
    return container
  }
}

export function createInjectScript(
  dependModules: Map<string, ModuleInfo>,
  url: string
) {
  return new InjectScript(dependModules, url)
}
