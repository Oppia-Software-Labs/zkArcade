import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from './components/HomePage';
import { Battleship3DWithContract } from './components/Battleship3DWithContract';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/game" element={<Battleship3DWithContract />} />
      </Routes>
    </BrowserRouter>
  );
}
