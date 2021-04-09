import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'react-query'

import './App.css'

const getTodoItems = () => fetch('/api/todos').then(x => x.json())
const newTodoItem = (body) => fetch('/api/todos', { method: "POST", body: JSON.stringify(body) }).then(x => x.json())


function App() {
  const { data, isLoading } = useQuery('todo-items', getTodoItems)
  const create = useMutation('new-todo-item', newTodoItem)

  const createItem = (title) => {
    create.mutate({
      title: title,
      completed: false
    })
  }


  return (
    <div className="App">
      <header className="App-header">
        <h2>My TO-DOs</h2>
      </header>
      <div className="content">
        <input type="text" onKeyDown={(event) => event.key === "Enter" && createItem(event.target.value)}></input>
        <ul>
          {data?.items.map(x => (<li key={x.id}><input type="checkbox" checked={x.completed} /> {x.title}</li>))}
        </ul>
      </div>
      <footer style={{ marginTop: '1rem' }}>
        Powered by <a href="https://lambada-project.github.io">Lambada</a>
      </footer>
    </div>
  );
}

export default App
