import React from "react";
import { Routes, Route } from "react-router-dom";
import Dashboard from "./components/Dashboard";
import WorkflowDetail from "./components/WorkflowDetail";
import RunDetail from "./components/RunDetail";
import Layout from "./components/Layout";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/workflow/:subId/:rg/:site/:name" element={<WorkflowDetail />} />
        <Route path="/workflow/:subId/:rg/:site/:name/run/:runName" element={<RunDetail />} />
      </Routes>
    </Layout>
  );
}
