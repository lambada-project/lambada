import { useEffect, useState } from 'react'
import './App.css'


function App() {
  const [todos, setTodos] = useState({ items: [] })
  useEffect(() => {
    fetch('/api/todos')
      .then(x => x.json())
      .then(setTodos)

  }, [])
  return (
    <div className="App">
      <header className="App-header">
        <ul>
          {todos.items.map(x => (<li key={x.id}> {x.title}</li>))}
        </ul>
      </header>
    </div>
  );
}

export default App
