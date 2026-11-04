import { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, placeholder as cmPlaceholder, drawSelection, highlightSpecialChars } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { xml } from '@codemirror/lang-xml'
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, foldKeymap } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap, autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { useStore } from '@/store'

export type Lang = 'json' | 'javascript' | 'html' | 'xml' | 'text' | 'shell' | 'python' | string

function langExt(l: Lang) {
  switch (l) { case 'json': return json(); case 'javascript': case 'js': return javascript(); case 'html': return html(); case 'xml': return xml(); default: return [] }
}

const PM_COMPLETIONS = ['pm.test(', 'pm.expect(', 'pm.response.json()', 'pm.response.text()', 'pm.response.code', 'pm.response.to.have.status(', 'pm.response.to.be.ok', 'pm.response.to.have.header(', 'pm.response.to.have.jsonBody(', 'pm.response.to.have.jsonSchema(', 'pm.response.headers.get(', 'pm.response.responseTime', 'pm.environment.get(', 'pm.environment.set(', 'pm.environment.unset(', 'pm.globals.get(', 'pm.globals.set(', 'pm.collectionVariables.get(', 'pm.collectionVariables.set(', 'pm.variables.get(', 'pm.variables.set(', 'pm.variables.replaceIn(', 'pm.iterationData.get(', 'pm.request.headers.add({ key: "", value: "" })', 'pm.request.headers.upsert({ key: "", value: "" })', 'pm.request.url.query.add({ key: "", value: "" })', 'pm.request.url.toString()', 'pm.sendRequest(', 'pm.execution.setNextRequest(', 'pm.execution.skipRequest()', 'pm.cookies.get(', 'pm.info.requestName', 'pm.info.iteration', 'console.log(', 'require("crypto-js")', 'require("uuid")', 'require("lodash")', 'require("moment")']

export default function CodeEditor({ value, onChange, lang = 'text', readOnly, placeholder, minHeight, wrap, variables }: { value: string; onChange?: (v: string) => void; lang?: Lang; readOnly?: boolean; placeholder?: string; minHeight?: number; wrap?: boolean; variables?: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeC = useRef(new Compartment()); const langC = useRef(new Compartment()); const roC = useRef(new Compartment()); const wrapC = useRef(new Compartment())
  const theme = useStore((s) => s.theme)
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange
  const varsRef = useRef(variables); varsRef.current = variables

  useEffect(() => {
    if (!ref.current) return
    const completions = (ctx: CompletionContext) => {
      const varWord = ctx.matchBefore(/\{\{[\w$.-]*/)
      if (varWord) return { from: varWord.from + 2, options: (varsRef.current ?? []).map((v) => ({ label: v, apply: v + '}}' })).concat(['$guid', '$timestamp', '$isoTimestamp', '$randomInt', '$randomUUID', '$randomEmail', '$randomFirstName', '$randomLastName', '$randomFullName', '$randomBoolean', '$randomWord', '$randomLoremSentence'].map((v) => ({ label: v, apply: v + '}}' }))) }
      if (lang !== 'javascript') return null
      const w = ctx.matchBefore(/[\w.$]+/)
      if (!w || (w.from === w.to && !ctx.explicit)) return null
      return { from: w.from, options: PM_COMPLETIONS.map((c) => ({ label: c, type: 'function' })), validFor: /^[\w.$]*$/ }
    }
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(), highlightSpecialChars(), history(), foldGutter(), drawSelection(), indentOnInput(), bracketMatching(), closeBrackets(), highlightActiveLine(), highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        autocompletion({ override: [completions] }),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
        langC.current.of(langExt(lang)),
        themeC.current.of(theme === 'dark' ? oneDark : []),
        roC.current.of(EditorState.readOnly.of(!!readOnly)),
        wrapC.current.of(wrap ? EditorView.lineWrapping : []),
        placeholder ? cmPlaceholder(placeholder) : [],
        EditorView.updateListener.of((u) => { if (u.docChanged) onChangeRef.current?.(u.state.doc.toString()) }),
        EditorView.theme({ '&': { ...(minHeight ? { minHeight: minHeight + 'px' } : {}), height: '100%' }, '.cm-scroller': { overflow: 'auto' }, '.cm-content': { ...(minHeight ? { minHeight: minHeight + 'px' } : {}) } }),
      ],
    })
    const view = new EditorView({ state, parent: ref.current })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { viewRef.current?.dispatch({ effects: themeC.current.reconfigure(theme === 'dark' ? oneDark : []) }) }, [theme])
  useEffect(() => { viewRef.current?.dispatch({ effects: langC.current.reconfigure(langExt(lang)) }) }, [lang])
  useEffect(() => { viewRef.current?.dispatch({ effects: roC.current.reconfigure(EditorState.readOnly.of(!!readOnly)) }) }, [readOnly])
  useEffect(() => { viewRef.current?.dispatch({ effects: wrapC.current.reconfigure(wrap ? EditorView.lineWrapping : []) }) }, [wrap])
  useEffect(() => {
    const v = viewRef.current; if (!v) return
    const cur = v.state.doc.toString()
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
  }, [value])
  return <div ref={ref} className="h-full w-full overflow-hidden text-xs" style={{ background: 'var(--bg)' }} />
}
