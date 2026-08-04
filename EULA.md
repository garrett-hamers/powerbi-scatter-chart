# End User License Agreement — Atlyn Scatter

**Product:** Atlyn Scatter (Power BI custom visual)
**Publisher:** Atlyn
**Contact:** atlyn.help@gmail.com
**Effective date:** 2026-01-01

This End User License Agreement ("Agreement") is a legal agreement between you ("You") and
Atlyn ("Publisher") for the Power BI custom visual named **Atlyn Scatter**, including its
`.pbiviz` package, sample content, and accompanying documentation (together, the "Software").

By installing, importing, or using the Software, You accept this Agreement. If You do not
accept it, do not install or use the Software.

## 1. Licence grant

The Software is distributed under the **MIT License**, reproduced in the `LICENSE` file that
accompanies the Software. Subject to that licence, the Publisher grants You a worldwide,
royalty-free, non-exclusive licence to use, copy, modify, merge, publish, distribute,
sublicense, and sell copies of the Software, including in commercial Power BI reports and
dashboards, and to redistribute it inside your own solutions.

In the event of a conflict between this Agreement and the MIT License, the MIT License
governs the grant of rights, and this Agreement governs only the supplemental terms below.

## 2. Conditions

The copyright notice and permission notice from the `LICENSE` file must be included in all
copies or substantial portions of the Software.

## 3. Data handling and privacy

The Software runs entirely inside the Power BI visual sandbox on the client.

- It declares **no privileges** in `capabilities.json` (`"privileges": []`), so it cannot
  request `WebAccess`, `ExportContent`, or `LocalStorage` permissions.
- It makes **no network requests**. It contains no `fetch`, `XMLHttpRequest`, or `WebSocket`
  usage, and this is enforced by an automated test in the source repository.
- It loads **no external runtime assets**, fonts, scripts, or telemetry.
- It **does not collect, transmit, store, or retain** any of your data. Values supplied by the
  Power BI host are held in memory only for the lifetime of the rendered visual.

The Publisher therefore has no access to, and receives no copy of, the data You visualise with
the Software. The Publisher's privacy policy is available at
<https://atlyn.io/legal/privacy>.

## 4. Restrictions

You may not represent the Software as certified, endorsed, or validated by Microsoft unless and
until such certification has actually been granted, and You may not remove or obscure the
copyright and licence notices distributed with the Software.

## 5. Support

Support is provided on a commercially reasonable, best-effort basis through
<https://atlyn.io/contact> and atlyn.help@gmail.com. No service level, response time, or
uptime commitment is offered or implied.

## 6. Updates

The Publisher may release updated versions of the Software through Microsoft AppSource. Updates
are governed by the version of this Agreement distributed with them.

## 7. Disclaimer of warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT.

## 8. Limitation of liability

IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## 9. Third-party terms

Your use of Microsoft Power BI and Microsoft AppSource is governed by Microsoft's own terms and
is not covered by this Agreement.

## 10. Termination

This Agreement terminates automatically if You breach its conditions. Sections 3, 7, 8, and 9
survive termination.

## 11. Entire agreement

This Agreement, together with the `LICENSE` file, is the entire agreement between You and the
Publisher regarding the Software. The Publisher's general terms are published at
<https://atlyn.io/legal/terms>.
