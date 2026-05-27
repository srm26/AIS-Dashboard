import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Dashboard from "./components/Dashboard";
import WorkflowDetail from "./components/WorkflowDetail";
import RunDetail from "./components/RunDetail";
import Layout from "./components/Layout";
import Login from "./components/Login";
import { getUser } from "./auth";

function ProtectedRoute({ children }) {
  return getUser() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={
        <ProtectedRoute>
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/workflow/:subId/:rg/:site/:name" element={<WorkflowDetail />} />
              <Route path="/workflow/:subId/:rg/:site/:name/run/:runName" element={<RunDetail />} />
            </Routes>
          </Layout>
        </ProtectedRoute>
      } />
    </Routes>
  );
}
