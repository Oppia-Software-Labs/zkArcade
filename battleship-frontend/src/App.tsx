import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Battleship3DWithContract } from './components/Battleship3DWithContract';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Battleship3DWithContract />} />
      </Routes>
    </BrowserRouter>
  );
}
