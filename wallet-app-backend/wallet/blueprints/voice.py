"""Voice: the endpoint in front of the transcript grammar.

The browser does the listening and sends the words it heard. Nothing here
authorises anything, the answer is a payee and an amount, and the PIN screen is
still the only thing that can move money.
"""

from flask import Blueprint, g, jsonify, request

from .. import voice
from ..security import require_auth

bp = Blueprint("voice", __name__)

# A recogniser emits a sentence, not a paragraph. The cap keeps a pasted wall of
# text from being walked token by token.
MAX_TRANSCRIPT = 200


@bp.post("/voice/interpret")
@require_auth
def interpret_voice():
    """Read "pay Rohan 250" into the payee and the sum.

    Always 200 with an `understood` flag when the sentence was merely not
    understood: "nobody is called that" is an answer to the question that was
    asked, and the sheet shows it in place rather than as a failure.
    """
    data = request.get_json(silent=True) or {}
    transcript = data.get("transcript")
    if not isinstance(transcript, str) or not transcript.strip():
        return jsonify({"message": "Say who you want to pay"}), 400
    if len(transcript) > MAX_TRANSCRIPT:
        return jsonify({"message": "That's too long. Try “pay Rohan 250”"}), 400

    if voice.throttled(g.user_id):
        return jsonify({"message": "Too many voice commands. Give it a moment."}), 429

    return jsonify(voice.interpret(transcript, g.user_id)), 200
