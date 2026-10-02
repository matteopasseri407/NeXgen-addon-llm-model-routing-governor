#!/usr/bin/env python3
"""Regression checks on the shipped n8n Code nodes, without network calls."""
import json
import subprocess
import unittest
from pathlib import Path

HARNESS = r'''
const [BUILD, ROUTE, RENDER, ASSEMBLE] = JSON.parse(process.argv[1]);
const build = BUILD.replace('aaModels: Array.isArray(aa && aa.data) ? aa.data : [],',
  'aaModels: Array.isArray(aa && aa.data) ? aa.data : [], minAa: 1,');
const inventory = '<!-- model-inventory:test:start -->\n- **codex**: `alpha` `beta`\n- **local**: `local:latest`\n<!-- model-inventory:test:end -->';
function run(code, nodes, inp) {
  return new Function('$','$input',code)(n => ({first:()=>({json:nodes[n]})}), {first:()=>({json:inp})});
}
function evaluate(patch) {
  const model = name => ({name, evaluations:{artificial_analysis_intelligence_index:60,hle:name==='Alpha'?0.9:0.1,lcr:0.5,gpqa:0.5},
    pricing:{price_1m_blended_3_to_1:1}, median_output_tokens_per_second:100});
  const aa = [model('Alpha'),model('Beta')];
  const dev = {'opencode-go':{models:{}},opencode:{models:{alpha:{cost:{input:1,output:1},limit:{context:1000,output:100}}}}};
  patch(aa, dev);
  const nodes = {'Read host inventory':{content:[{text:{full_content:inventory}}]}, 'Fetch AA catalog':{data:aa},
    'Fetch Zen catalog':{data:[{id:'alpha'}]}, 'Fetch models.dev':dev};
  const b = run(build,nodes,null)[0].json;
  const r = run(ROUTE,{},b)[0].json;
  return run(RENDER,{},r)[0].json;
}
const base = evaluate(()=>{});
const changes = {
  benchmark: aa=>{aa[0].evaluations.hle=0.1;aa[1].evaluations.hle=0.9;},
  speed: aa=>{aa[0].median_output_tokens_per_second=200;},
  weight: aa=>{aa[0].pricing.price_1m_blended_3_to_1=2;},
  context: (aa,dev)=>{dev.opencode.models.alpha.limit.context=2000;},
};
const result = {};
for (const [name,patch] of Object.entries(changes)) {
  const next=evaluate(patch);
  const crm={content:[{text:{full_content:'head\n'+base.block+'\ntail',content_hash:'synthetic'}}]};
  const update=run(ASSEMBLE,{'Render CRM block':next},crm);
  result[name]={before:base.fingerprint,after:next.fingerprint,updates:update.length,
    oldWinner:base.routing.find(r=>r.role.id==='L-Arch').picks[0].name,
    newWinner:next.routing.find(r=>r.role.id==='L-Arch').picks[0].name};
}
const same=evaluate(()=>{});
result.same={before:base.fingerprint,after:same.fingerprint,
  updates:run(ASSEMBLE,{'Render CRM block':same},{content:[{text:{full_content:base.block,content_hash:'synthetic'}}]}).length};
process.stdout.write(JSON.stringify(result));
'''


class FingerprintTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        workflow = Path(__file__).resolve().parents[1] / "workflows/model-routing-governor-demo.json"
        data = json.loads(workflow.read_text(encoding="utf-8"))
        names = ("Build catalog", "Route roles", "Render CRM block", "Assemble update")
        codes = [next(n["parameters"]["jsCode"] for n in data["nodes"] if n["name"] == name) for name in names]
        result = subprocess.run(["node", "-e", HARNESS, json.dumps(codes)],
                                capture_output=True, text=True, check=True, timeout=30)
        cls.results = json.loads(result.stdout)

    def test_inputs_that_affect_routing_and_rendering_trigger_updates(self):
        for key in ("benchmark", "speed", "weight", "context"):
            with self.subTest(key=key):
                result = self.results[key]
                self.assertNotEqual(result["before"], result["after"])
                self.assertEqual(result["updates"], 1)
        self.assertNotEqual(self.results["benchmark"]["oldWinner"], self.results["benchmark"]["newWinner"])

    def test_unchanged_inputs_do_not_write(self):
        result = self.results["same"]
        self.assertEqual(result["before"], result["after"])
        self.assertEqual(result["updates"], 0)


if __name__ == "__main__":
    unittest.main()
