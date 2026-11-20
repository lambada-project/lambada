import { useCallback, useEffect, useState } from 'react'

const api = async (path, init) => {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status})`)
  return body
}

export default function App() {
  const [todos, setTodos] = useState({ items: [], total: 0 })
  const [title, setTitle] = useState('')
  const [error, setError] = useState()

  const load = useCallback(() => api('/todos').then(setTodos).catch(e => setError(e.message)), [])
  useEffect(() => { load() }, [load])

  const add = async (event) => {
    event.preventDefault()
    setError(undefined)
    try {
      await api('/todos', { method: 'POST', body: JSON.stringify({ title }) })
      setTitle('')
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  const remind = async (id) => {
    setError(undefined)
    try {
      await api(`/todos/${id}/remind`, { method: 'POST' })
      setTimeout(load, 2000)   // the queue handler marks it shortly
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <main>
      <h1>My to-dos</h1>
      <form onSubmit={add}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Something to do" aria-label="New to-do" />
        <button type="submit">Add</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      <ul>
        {todos.items.map(todo => (
          <li key={todo.id}>
            <span>{todo.title}</span>
            {todo.remindedAt
              ? <small>reminded {new Date(todo.remindedAt).toLocaleTimeString()}</small>
              : <button onClick={() => remind(todo.id)}>Remind me</button>}
          </li>
        ))}
      </ul>
      <p className="muted">{todos.total} created so far, counted by a topic subscriber.</p>
      <footer>Powered by <a href="https://lambada-project.github.io">Lambada</a></footer>
    </main>
  )
}
