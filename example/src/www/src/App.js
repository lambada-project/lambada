import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'react-query'

import './App.css'

const getTodoItems = fetch('/api/todos').then(x => x.json())
const newTodoItem = (body) => fetch('/api/todos', { method: "POST", body: JSON.stringify(body) }).then(x => x.json())


function App() {
  const items = useQuery('todo-items', getTodoItems)
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
        <h2>Lambada to-do list</h2>
      </header>
      <div className="content">
        <input onKeyDown={(event) => event.key === "Enter" && createItem(event.target.value)}></input>
        <ul>
          {/* {items.map(x => (<li key={x.id}><input checked={x.completed} /> {x.title}</li>))} */}
        </ul>
      </div>
    </div>
  );
}

export default App
