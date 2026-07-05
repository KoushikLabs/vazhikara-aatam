import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Link } from "react-router-dom";
import HomeScreen from "./screens/HomeScreen.js";
import RoomScreen from "./screens/RoomScreen.js";
import RulesScreen from "./screens/RulesScreen.js";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/g/:code" element={<RoomScreen />} />
        <Route
          path="/rules"
          element={
            <RulesScreen
              headerAction={
                <Link to="/" className="btn btn-ghost" style={{ textDecoration: "none" }}>
                  Home
                </Link>
              }
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
