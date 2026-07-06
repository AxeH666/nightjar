"""Stub of row_bot.tools.base — BaseTool existed only to host the LangChain
adapter, which we dropped. Kept as a trivial base so subclasses still import."""
class BaseTool:
    name = "base"
    def as_langchain_tools(self):
        return []
