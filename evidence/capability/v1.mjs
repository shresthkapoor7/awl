// awl constrained capability; driver has no API, shell, or filesystem access.
export default async function run(driver, inputs) {
  await driver.step(0, {"operation":"navigate","selector":null,"input":null,"value":"http://127.0.0.1:7311/terminal.asp","output":null,"target":null}, inputs);
  await driver.step(1, {"operation":"click","selector":null,"input":null,"value":null,"output":null,"target":{"kind":"role","value":"10 Member inquiry","role":"link","frame":null,"shadow":[],"within":null}}, inputs);
  await driver.step(2, {"operation":"fill","selector":null,"input":"member_number","value":null,"output":null,"target":{"kind":"css","value":"input[name=\"f01\"]","role":null,"frame":{"url":"http://127.0.0.1:7311/screen.asp","name":"work"},"shadow":[],"within":null}}, inputs);
  await driver.step(3, {"operation":"click","selector":null,"input":null,"value":null,"output":null,"target":{"kind":"role","value":"Transmit","role":"button","frame":{"url":"http://127.0.0.1:7311/screen.asp","name":"work"},"shadow":[],"within":null}}, inputs);
  await driver.step(4, {"operation":"click","selector":null,"input":null,"value":null,"output":null,"target":{"kind":"css","value":"input[name=\"row\"]","role":null,"frame":{"url":"http://127.0.0.1:7311/screen.asp","name":"work"},"shadow":[],"within":null}}, inputs);
  await driver.step(5, {"operation":"click","selector":null,"input":null,"value":null,"output":null,"target":{"kind":"role","value":"Process selected record >","role":"button","frame":{"url":"http://127.0.0.1:7311/screen.asp","name":"work"},"shadow":[],"within":null}}, inputs);
  await driver.step(6, {"operation":"click","selector":null,"input":null,"value":null,"output":null,"target":{"kind":"role","value":"01 Share register","role":"link","frame":{"url":"http://127.0.0.1:7311/screen.asp","name":"work"},"shadow":[],"within":null}}, inputs);
  await driver.step(7, {"operation":"extract_text","selector":null,"input":null,"value":null,"output":"account_row","target":{"kind":"css","value":"body","role":null,"frame":{"url":"http://127.0.0.1:7311/accounts.asp","name":"register"},"shadow":[],"within":null}}, inputs);
  await driver.step(8, {"operation":"extract_text","selector":null,"input":null,"value":null,"output":"available_usd","target":{"kind":"css","value":"body","role":null,"frame":{"url":"http://127.0.0.1:7311/accounts.asp","name":"register"},"shadow":[],"within":null}}, inputs);
  await driver.step(9, {"operation":"assert_text","selector":null,"input":null,"value":"{{account_number}}","output":null,"target":{"kind":"text","value":"{{account_number}}","role":null,"frame":{"url":"http://127.0.0.1:7311/accounts.asp","name":"register"},"shadow":[],"within":null}}, inputs);
  return driver.outputs();
}
